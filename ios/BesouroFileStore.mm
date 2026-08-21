#import "BesouroFileStore.h"

static NSString *const kStorageDir   = @"RNBesouro";
// JS-owned settings file; see +readBubbleAppearance.
static NSString *const kSettingsFile  = @"besouro_settings.json";

@implementation BesouroFileStore

+ (NSString *)directory {
  NSString *applicationSupport = [NSSearchPathForDirectoriesInDomains(
      NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
  NSString *directory = [applicationSupport stringByAppendingPathComponent:kStorageDir];
  [[NSFileManager defaultManager] createDirectoryAtPath:directory
                           withIntermediateDirectories:YES
                                            attributes:nil
                                                 error:nil];
  return directory;
}

+ (NSString *)pathForFilename:(NSString *)filename {
  return [[self directory] stringByAppendingPathComponent:filename];
}

+ (NSString *)readFile:(NSString *)filename {
  return [NSString stringWithContentsOfFile:[self pathForFilename:filename]
                                   encoding:NSUTF8StringEncoding
                                      error:nil];
}

+ (BOOL)writeFile:(NSString *)filename
          content:(NSString *)content
            error:(NSError **)error {
  return [content writeToFile:[self pathForFilename:filename]
                   atomically:YES
                     encoding:NSUTF8StringEncoding
                        error:error];
}

+ (void)deleteFile:(NSString *)filename {
  [[NSFileManager defaultManager] removeItemAtPath:[self pathForFilename:filename]
                                             error:nil];
}

+ (NSDictionary<NSString *, NSString *> *)readBubbleAppearance {
  NSString *raw = [self readFile:kSettingsFile];
  if (raw.length == 0) return @{};

  NSData *data = [raw dataUsingEncoding:NSUTF8StringEncoding];
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![parsed isKindOfClass:[NSDictionary class]]) return @{};

  // Both keys default to a written JSON `null`, which parses to NSNull — hence
  // the class check rather than a nil test.
  NSMutableDictionary<NSString *, NSString *> *appearance = [NSMutableDictionary dictionary];
  for (NSString *key in @[ @"theme", @"accent" ]) {
    id value = parsed[key];
    if ([value isKindOfClass:[NSString class]] && [(NSString *)value length] > 0) {
      appearance[key] = value;
    }
  }
  return appearance;
}

@end
