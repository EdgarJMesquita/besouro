#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// ─── Filesystem persistence ─────────────────────────────────────────────────
// The library's own directory under Library/Application Support, holding
// everything it keeps on disk: the JS-side settings files (readFile/writeFile/
// deleteFile on the main module), the persisted bubble position, and the
// captured-event database.
//
// It is the single definition of that location. Anything of ours that touches
// the directory goes through here rather than rebuilding the path, so the
// database and the settings files cannot drift into separate directories.

@interface BesouroFileStore : NSObject

/// The storage directory, created on demand.
+ (NSString *)directory;

/// Absolute path for a file in the storage directory.
+ (NSString *)pathForFilename:(NSString *)filename;

/// UTF-8 contents of `filename`, or nil when it is absent or unreadable.
+ (nullable NSString *)readFile:(NSString *)filename;

/// Writes `content` atomically. Returns NO and populates `error` on failure.
+ (BOOL)writeFile:(NSString *)filename
          content:(NSString *)content
            error:(NSError **)error;

/// Removes `filename`. A missing file is not an error.
+ (void)deleteFile:(NSString *)filename;

/// The two bubble-facing keys — `theme` and `accent` — out of the JS settings
/// file, which JS owns and writes. The only file here read from both sides: the
/// bubble needs its colors before its entrance animation, and JS reads this file
/// asynchronously, so it cannot supply them in time. Entries are present only
/// when stored as non-empty strings; the rest of the file is the drawer's
/// business. See `settings-store.ts`, where the keys are defined.
+ (NSDictionary<NSString *, NSString *> *)readBubbleAppearance;

@end

NS_ASSUME_NONNULL_END
