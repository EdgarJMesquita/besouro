#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// ─── Share ──────────────────────────────────────────────────────────────────
// The OS share sheet, for a sandbox file the File System inspector is browsing
// or for bytes the Network inspector captured.
//
// Note the spec's `mimeType` argument does not reach here: UIActivityViewController
// infers the UTI from the file extension, so it is Android-only. Fire-and-forget
// throughout — a missing file, a failed write or a share the user cancels is a
// silent no-op.
//
// Main thread only; the module does the hopping.

@interface BesouroShare : NSObject

/// Shares an existing sandbox file in place (its real file:// URL) — no copy is
/// made, so nothing new appears in the File System inspector.
+ (void)shareFileAtPath:(NSString *)path
        preferredWindow:(nullable UIWindow *)preferredWindow;

/// Shares bytes that only exist in JS (a captured network image): decodes them,
/// writes a temporary copy, and shares that. Unlike Android — where the receiver
/// reads the content:// URI long after the chooser returns — UIActivityViewController
/// reports completion once the activity has taken the item, so the copy is deleted
/// there and nothing is left behind.
+ (void)shareBase64:(NSString *)base64
           filename:(NSString *)filename
    preferredWindow:(nullable UIWindow *)preferredWindow;

@end

NS_ASSUME_NONNULL_END
