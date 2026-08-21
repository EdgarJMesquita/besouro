#import "BesouroDatabase.h"
#import "BesouroFileStore.h"
#import <Foundation/Foundation.h>
#import <sqlite3.h>

// Captured-event database, backed by the sqlite3 the system already ships (linked
// via `s.library = "sqlite3"` in the podspec — no vendored engine, no dependency).
// Mirrors the Android BesouroDatabaseModule.
//
// This is a thin, generic SQL port: the schema, the queries and the row mapping all
// live in JS (`core/persistence/`), so a column change never touches native code.
//
// Threading: a `sqlite3 *` must have exactly one owner, so every method hops onto
// one private serial queue and nothing touches `_db` off it. The methods are all
// promise-returning, so the hop is invisible to JS.

static NSString *const kDatabaseFile = @"besouro.db";
static NSString *const kErrorDomain  = @"BesouroDatabase";

@implementation BesouroDatabase {
  sqlite3 *_db;
  dispatch_queue_t _queue;
}

- (instancetype)init {
  if (self = [super init]) {
    _db = NULL;
    _queue = dispatch_queue_create("com.besouro.database",
                                   DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (void)dealloc {
  // Close on the queue so we can't free the handle while a statement is running.
  sqlite3 *db = _db;
  _db = NULL;
  if (db) {
    dispatch_sync(_queue, ^{
      sqlite3_close_v2(db);
    });
  }
}

#pragma mark - Errors

- (NSError *)errorWithMessage:(NSString *)message {
  return [NSError errorWithDomain:kErrorDomain
                             code:0
                         userInfo:@{ NSLocalizedDescriptionKey: message ?: @"unknown error" }];
}

// The message sqlite left on the connection, for a reject() the JS side can log.
- (NSString *)lastErrorMessage {
  const char *message = _db ? sqlite3_errmsg(_db) : NULL;
  return message ? [NSString stringWithUTF8String:message] : @"unknown sqlite error";
}

#pragma mark - Parameter binding

// Decode a JSON array of bind values. Returns nil (and sets `error`) when the
// payload isn't a JSON array — a programming error on the JS side, so it rejects
// rather than silently running an unbound statement.
- (NSArray *)paramsFromJson:(NSString *)paramsJson error:(NSError **)error {
  if (paramsJson.length == 0) return @[];
  NSData *data = [paramsJson dataUsingEncoding:NSUTF8StringEncoding];
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![parsed isKindOfClass:[NSArray class]]) {
    if (error) *error = [self errorWithMessage:@"params must be a JSON array"];
    return nil;
  }
  return (NSArray *)parsed;
}

// Bind positionally (sqlite indexes are 1-based). Booleans bind as 0/1 — SQLite has
// no boolean type and the JS row mappers read them back as integers.
- (BOOL)bindParams:(NSArray *)params toStatement:(sqlite3_stmt *)statement {
  int index = 1;
  for (id value in params) {
    int status;
    if (value == nil || [value isKindOfClass:[NSNull class]]) {
      status = sqlite3_bind_null(statement, index);
    } else if ([value isKindOfClass:[NSNumber class]]) {
      NSNumber *number = (NSNumber *)value;
      // __NSCFBoolean reports a char objCType; everything else is a real number.
      if (strcmp(number.objCType, @encode(char)) == 0) {
        status = sqlite3_bind_int64(statement, index, number.boolValue ? 1 : 0);
      } else if (CFNumberIsFloatType((CFNumberRef)number)) {
        status = sqlite3_bind_double(statement, index, number.doubleValue);
      } else {
        status = sqlite3_bind_int64(statement, index, number.longLongValue);
      }
    } else if ([value isKindOfClass:[NSString class]]) {
      // SQLITE_TRANSIENT: sqlite copies the bytes, so the NSString may be released
      // before the statement runs.
      status = sqlite3_bind_text(statement, index,
                                 [(NSString *)value UTF8String], -1,
                                 SQLITE_TRANSIENT);
    } else {
      // Arrays/objects are never bound directly — the JS side stringifies them
      // into text columns first. Treat anything else as NULL rather than guessing.
      status = sqlite3_bind_null(statement, index);
    }
    if (status != SQLITE_OK) return NO;
    index++;
  }
  return YES;
}

#pragma mark - Statement running (queue-confined)

// Run a non-row statement. Caller must already be on _queue.
- (BOOL)runStatement:(NSString *)sql
              params:(NSArray *)params
         changedRows:(int *)changedRows
               error:(NSError **)error {
  sqlite3_stmt *statement = NULL;
  if (sqlite3_prepare_v2(_db, [sql UTF8String], -1, &statement, NULL) != SQLITE_OK) {
    if (error) *error = [self errorWithMessage:[self lastErrorMessage]];
    return NO;
  }
  if (![self bindParams:params toStatement:statement]) {
    sqlite3_finalize(statement);
    if (error) *error = [self errorWithMessage:[self lastErrorMessage]];
    return NO;
  }
  int status = sqlite3_step(statement);
  sqlite3_finalize(statement);
  if (status != SQLITE_DONE && status != SQLITE_ROW) {
    if (error) *error = [self errorWithMessage:[self lastErrorMessage]];
    return NO;
  }
  if (changedRows) *changedRows = sqlite3_changes(_db);
  return YES;
}

#pragma mark - Spec

- (void)open:(RCTPromiseResolveBlock)resolve
      reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_queue, ^{
    if (self->_db) {
      resolve(nil);  // Idempotent — already open.
      return;
    }
    // Library/Application Support/RNBesouro/ — the same directory the
    // settings files use, defined once in BesouroFileStore.
    NSString *path = [BesouroFileStore pathForFilename:kDatabaseFile];

    sqlite3 *db = NULL;
    int status = sqlite3_open_v2(
        [path UTF8String], &db,
        SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, NULL);
    if (status != SQLITE_OK) {
      NSString *message = db ? [NSString stringWithUTF8String:sqlite3_errmsg(db)]
                             : @"could not open database";
      sqlite3_close_v2(db);
      reject(kErrorDomain, message, [self errorWithMessage:message]);
      return;
    }
    self->_db = db;

    // WAL lets reads (the drawer paging) proceed while a flush writes;
    // synchronous=NORMAL trades an fsync per commit for throughput, which is the
    // right call for capture data that is reconstructible by definition.
    sqlite3_exec(db, "PRAGMA journal_mode=WAL;", NULL, NULL, NULL);
    sqlite3_exec(db, "PRAGMA synchronous=NORMAL;", NULL, NULL, NULL);

    // Captured logs are disposable and can grow large — keep them out of iCloud
    // and iTunes backups. Applies to the -wal/-shm siblings too, which live in the
    // same excluded directory.
    NSURL *url = [NSURL fileURLWithPath:path];
    [url setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:nil];

    resolve(nil);
  });
}

- (void)execute:(NSString *)sql
     paramsJson:(NSString *)paramsJson
        resolve:(RCTPromiseResolveBlock)resolve
         reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_queue, ^{
    if (!self->_db) {
      reject(kErrorDomain, @"database is not open", nil);
      return;
    }
    NSError *error = nil;
    NSArray *params = [self paramsFromJson:paramsJson error:&error];
    if (!params) {
      reject(kErrorDomain, error.localizedDescription, error);
      return;
    }
    int changed = 0;
    if (![self runStatement:sql params:params changedRows:&changed error:&error]) {
      reject(kErrorDomain, error.localizedDescription, error);
      return;
    }
    resolve(@(changed));
  });
}

- (void)query:(NSString *)sql
   paramsJson:(NSString *)paramsJson
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_queue, ^{
    if (!self->_db) {
      reject(kErrorDomain, @"database is not open", nil);
      return;
    }
    NSError *error = nil;
    NSArray *params = [self paramsFromJson:paramsJson error:&error];
    if (!params) {
      reject(kErrorDomain, error.localizedDescription, error);
      return;
    }

    sqlite3_stmt *statement = NULL;
    if (sqlite3_prepare_v2(self->_db, [sql UTF8String], -1, &statement, NULL) !=
        SQLITE_OK) {
      reject(kErrorDomain, [self lastErrorMessage], nil);
      return;
    }
    if (![self bindParams:params toStatement:statement]) {
      NSString *message = [self lastErrorMessage];
      sqlite3_finalize(statement);
      reject(kErrorDomain, message, nil);
      return;
    }

    NSMutableArray<NSDictionary *> *rows = [NSMutableArray new];
    int status;
    while ((status = sqlite3_step(statement)) == SQLITE_ROW) {
      int columnCount = sqlite3_column_count(statement);
      NSMutableDictionary *row =
          [NSMutableDictionary dictionaryWithCapacity:columnCount];
      for (int i = 0; i < columnCount; i++) {
        const char *rawName = sqlite3_column_name(statement, i);
        if (!rawName) continue;
        NSString *name = [NSString stringWithUTF8String:rawName];
        switch (sqlite3_column_type(statement, i)) {
          case SQLITE_INTEGER:
            row[name] = @(sqlite3_column_int64(statement, i));
            break;
          case SQLITE_FLOAT:
            row[name] = @(sqlite3_column_double(statement, i));
            break;
          case SQLITE_TEXT: {
            const unsigned char *text = sqlite3_column_text(statement, i);
            row[name] = text ? [NSString stringWithUTF8String:(const char *)text]
                             : (id)[NSNull null];
            break;
          }
          // Nothing in the schema stores BLOBs (image previews are base64 text),
          // so one would mean a schema/mapper mismatch — surface it as null
          // rather than inventing an encoding.
          case SQLITE_BLOB:
          case SQLITE_NULL:
          default:
            row[name] = [NSNull null];
            break;
        }
      }
      [rows addObject:row];
    }
    sqlite3_finalize(statement);

    if (status != SQLITE_DONE) {
      reject(kErrorDomain, [self lastErrorMessage], nil);
      return;
    }

    NSError *jsonError = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:rows
                                                   options:0
                                                     error:&jsonError];
    if (!json) {
      reject(kErrorDomain, jsonError.localizedDescription, jsonError);
      return;
    }
    resolve([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding]);
  });
}

- (void)batch:(NSString *)statementsJson
      resolve:(RCTPromiseResolveBlock)resolve
       reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(_queue, ^{
    NSError *error = nil;
    if (![self runBatchJson:statementsJson error:&error]) {
      reject(kErrorDomain, error.localizedDescription, error);
      return;
    }
    resolve(nil);
  });
}

// `batch`, run synchronously — the JS thread blocks here until the transaction
// commits. Only the crash path calls it: a fatal error tears the app down before
// any promise can resolve, so the crash row has to be written while the process
// is still alive.
//
// Still hops onto `_queue` (dispatch_sync, so the caller waits) rather than
// touching `_db` directly, keeping the single-owner threading contract — a crash
// landing mid-flush waits for that flush instead of interleaving with it. There
// is no deadlock to worry about: only the queue itself could re-enter, and it
// never calls in here.
- (NSNumber *)batchSync:(NSString *)statementsJson {
  __block BOOL committed = NO;
  dispatch_sync(_queue, ^{
    // Never throws or rejects: the caller is a crash handler with nowhere to
    // report, and raising here would mask the error being recorded.
    committed = [self runBatchJson:statementsJson error:NULL];
  });
  return @(committed);
}

// One transaction of statements. Callers must already be on `_queue`.
- (BOOL)runBatchJson:(NSString *)statementsJson error:(NSError **)error {
  if (!_db) {
    if (error) *error = [self errorWithMessage:@"database is not open"];
    return NO;
  }
  NSError *parseError = nil;
  NSArray *statements = [self paramsFromJson:statementsJson error:&parseError];
  if (!statements) {
    if (error) *error = parseError;
    return NO;
  }
  if (statements.count == 0) return YES;

  if (sqlite3_exec(_db, "BEGIN IMMEDIATE;", NULL, NULL, NULL) != SQLITE_OK) {
    if (error) *error = [self errorWithMessage:[self lastErrorMessage]];
    return NO;
  }

  for (id entry in statements) {
    if (![entry isKindOfClass:[NSDictionary class]]) continue;
    NSString *sql = ((NSDictionary *)entry)[@"sql"];
    if (![sql isKindOfClass:[NSString class]]) continue;
    id rawParams = ((NSDictionary *)entry)[@"params"];
    NSArray *params =
        [rawParams isKindOfClass:[NSArray class]] ? (NSArray *)rawParams : @[];

    if (![self runStatement:sql params:params changedRows:NULL error:error]) {
      // Roll the whole flush back — a half-applied batch would leave rows the JS
      // side believes it has already written.
      sqlite3_exec(_db, "ROLLBACK;", NULL, NULL, NULL);
      return NO;
    }
  }

  if (sqlite3_exec(_db, "COMMIT;", NULL, NULL, NULL) != SQLITE_OK) {
    if (error) *error = [self errorWithMessage:[self lastErrorMessage]];
    sqlite3_exec(_db, "ROLLBACK;", NULL, NULL, NULL);
    return NO;
  }
  return YES;
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeBesouroDatabaseSpecJSI>(params);
}

+ (NSString *)moduleName {
  return @"BesouroDatabase";
}

@end
