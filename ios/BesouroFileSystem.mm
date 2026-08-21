#import "BesouroFileSystem.h"
#import <Foundation/Foundation.h>

// Dedicated native module for the File System inspector — read-only browsing of
// the app's sandbox tree, mirroring the Android BesouroFileSystemModule. Every
// method resolves a JSON string. All `path` arguments are confined to the sandbox
// roots below; a path that escapes them (via `..` or symlink) is rejected before
// any file access.

@implementation BesouroFileSystem {
  NSArray<NSDictionary *> *_rootsCache;
}

// The sandbox roots the browser may enter, each resolved to a canonical path so
// containment checks compare like-for-like. Computed once per module instance.
- (NSArray<NSDictionary *> *)roots {
  if (_rootsCache) return _rootsCache;

  NSMutableArray<NSDictionary *> *roots = [NSMutableArray new];
  void (^add)(NSString *, NSString *, NSString *) =
      ^(NSString *key, NSString *label, NSString *rawPath) {
        if (rawPath.length == 0) return;
        NSString *canonical =
            [[rawPath stringByStandardizingPath] stringByResolvingSymlinksInPath];
        [roots addObject:@{ @"key": key, @"label": label, @"path": canonical }];
      };

  add(@"documents", @"Documents",
      NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject);
  add(@"library", @"Library",
      NSSearchPathForDirectoriesInDomains(NSLibraryDirectory, NSUserDomainMask, YES).firstObject);
  add(@"cache", @"Caches",
      NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES).firstObject);
  add(@"tmp", @"Temporary", NSTemporaryDirectory());

  _rootsCache = roots;
  return _rootsCache;
}

// Resolve `path` to a canonical path inside a root, or nil if it escapes them.
- (NSString *)resolveWithinRoots:(NSString *)path {
  if (path.length == 0) return nil;
  NSString *canonical =
      [[path stringByStandardizingPath] stringByResolvingSymlinksInPath];
  for (NSDictionary *root in [self roots]) {
    NSString *base = root[@"path"];
    if ([canonical isEqualToString:base] ||
        [canonical hasPrefix:[base stringByAppendingString:@"/"]]) {
      return canonical;
    }
  }
  return nil;
}

- (NSDictionary *)entryDictForPath:(NSString *)fullPath {
  NSFileManager *fm = [NSFileManager defaultManager];
  BOOL isDir = NO;
  BOOL exists = [fm fileExistsAtPath:fullPath isDirectory:&isDir];
  NSDictionary *attrs = exists ? [fm attributesOfItemAtPath:fullPath error:nil] : nil;
  NSDate *modified = attrs.fileModificationDate;
  return @{
    @"name": fullPath.lastPathComponent ?: @"",
    @"path": fullPath,
    @"isDirectory": @(isDir),
    @"sizeBytes": @(attrs.fileSize),
    @"modifiedAt": @(modified ? modified.timeIntervalSince1970 * 1000.0 : 0),
  };
}

- (NSString *)jsonStringFrom:(id)object fallback:(NSString *)fallback {
  if (!object) return fallback;
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  if (!data) return fallback;
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

- (void)listRoots:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {
  @try {
    NSFileManager *fm = [NSFileManager defaultManager];
    NSMutableArray<NSDictionary *> *available = [NSMutableArray new];
    for (NSDictionary *root in [self roots]) {
      if ([fm fileExistsAtPath:root[@"path"]]) {
        [available addObject:root];
      }
    }
    resolve([self jsonStringFrom:available fallback:@"[]"]);
  } @catch (NSException *exception) {
    reject(@"BesouroFileSystem", exception.reason, nil);
  }
}

- (void)listDirectory:(NSString *)path
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject {
  @try {
    NSString *dir = [self resolveWithinRoots:path];
    NSFileManager *fm = [NSFileManager defaultManager];
    BOOL isDir = NO;
    if (!dir || ![fm fileExistsAtPath:dir isDirectory:&isDir] || !isDir) {
      resolve(@"[]");
      return;
    }
    NSArray<NSString *> *names = [fm contentsOfDirectoryAtPath:dir error:nil] ?: @[];
    NSMutableArray<NSDictionary *> *entries = [NSMutableArray new];
    for (NSString *name in names) {
      NSString *child = [dir stringByAppendingPathComponent:name];
      [entries addObject:[self entryDictForPath:child]];
    }
    resolve([self jsonStringFrom:entries fallback:@"[]"]);
  } @catch (NSException *exception) {
    reject(@"BesouroFileSystem", exception.reason, nil);
  }
}

- (void)statPath:(NSString *)path
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject {
  @try {
    NSString *resolved = [self resolveWithinRoots:path];
    if (!resolved) {
      resolve([self jsonStringFrom:@{ @"exists": @NO } fallback:@"{}"]);
      return;
    }
    BOOL exists = [[NSFileManager defaultManager] fileExistsAtPath:resolved];
    NSMutableDictionary *dict =
        [[self entryDictForPath:resolved] mutableCopy];
    dict[@"exists"] = @(exists);
    resolve([self jsonStringFrom:dict fallback:@"{}"]);
  } @catch (NSException *exception) {
    reject(@"BesouroFileSystem", exception.reason, nil);
  }
}

- (void)readFileAtPath:(NSString *)path
              maxBytes:(double)maxBytes
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject {
  NSString *resolved = [self resolveWithinRoots:path];
  NSFileManager *fm = [NSFileManager defaultManager];
  BOOL isDir = NO;
  if (!resolved || ![fm fileExistsAtPath:resolved isDirectory:&isDir] || isDir) {
    resolve(nil);
    return;
  }
  // Refuse oversized reads so a large file never lands in JS.
  NSDictionary *attrs = [fm attributesOfItemAtPath:resolved error:nil];
  if (attrs.fileSize > (unsigned long long)maxBytes) {
    resolve(nil);
    return;
  }
  // Nil for binary / non-UTF-8 content — the JS side degrades to "can't preview".
  NSString *content = [NSString stringWithContentsOfFile:resolved
                                                encoding:NSUTF8StringEncoding
                                                   error:nil];
  resolve(content);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeBesouroFileSystemSpecJSI>(params);
}

+ (NSString *)moduleName {
  return @"BesouroFileSystem";
}

@end
