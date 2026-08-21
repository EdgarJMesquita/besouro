#import <UIKit/UIKit.h>
#import <React/RCTBridgeModule.h>

NS_ASSUME_NONNULL_BEGIN

// ─── Element picker ─────────────────────────────────────────────────────────
// The native half of the element inspector (SPEC §6.6). Floats a transparent
// capture window over the app; the next tap reports its point in the app root
// view's coordinate space along with the chain of native views under it, then
// removes the window.
//
// The native path is the only one that survives a release build — the renderer's
// own hit-test is a throwing stub there — so this is built purely from public
// UIKit geometry and carries the React tags JS needs to find matching fibers.
//
// Main thread only; the module does the hopping.

@interface BesouroElementPicker : NSObject

/// Enters pick mode. The next tap invokes `onResult(x, y, rootTag, path)` exactly
/// once and tears the capture window down. One-shot: a pending pick is replaced.
/// The caller is responsible for dismissing the drawer first, so the app is
/// visible to pick from.
- (void)startWithResult:(RCTResponseSenderBlock)onResult;

/// Removes the capture window without reporting a result.
- (void)discard;

@end

NS_ASSUME_NONNULL_END
