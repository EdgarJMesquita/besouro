#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// Accessibility identifiers tagging the windows this library puts on screen.
// They are how `appRootView` tells the app's own window apart from ours, and how
// windows orphaned by a previous module instance are found after a reload.
FOUNDATION_EXPORT NSString *const BesouroBubbleWindowIdentifier;
FOUNDATION_EXPORT NSString *const BesouroWindowIdentifier;
FOUNDATION_EXPORT NSString *const BesouroPickWindowIdentifier;

// ─── Pass-through window ────────────────────────────────────────────────────
// Used for the floating bubble only. Touches that land on the transparent
// background (anything that is not the bubble view) return nil so they fall
// through to the app window below.

@interface BesouroPassthroughWindow : UIWindow
@end

// ─── Window retention ───────────────────────────────────────────────────────
// A UIWindow attached to a scene is not retained by UIKit, so every window this
// library shows is held here. The store is a process singleton and deliberately
// outlives the module: a JS reload builds a new module instance while the bubble
// window stays on screen, and the new instance re-adopts it.

@interface BesouroWindowStore : NSObject
+ (instancetype)shared;
- (void)retainWindow:(UIWindow *)window;
/// Hides `window` and drops our reference. Tolerates nil and unknown windows.
- (void)releaseWindow:(nullable UIWindow *)window;
/// Every retained window carrying `identifier`.
- (NSArray<UIWindow *> *)windowsWithIdentifier:(NSString *)identifier;
@end

// ─── Window lookups ─────────────────────────────────────────────────────────
// Reads over the window hierarchy. All are UIKit reads, so main thread only.

@interface BesouroWindows : NSObject

/// The foreground-active window scene, or nil when none is.
+ (nullable UIWindowScene *)activeWindowScene;

/// The scene our own overlay windows belong to — the bubble window's scene when
/// one is mounted, else the active scene.
+ (nullable UIWindowScene *)overlayWindowScene;

/// The app's own root view: the first window that is none of ours. Used for
/// element-pick coordinate conversion and as a safe-area fallback.
+ (nullable UIView *)appRootView;

/// The app's key window, preferring the active scene's and falling back to its
/// first window.
+ (nullable UIWindow *)appKeyWindow;

/// Safe-area insets of the app's window, in points, or zero when no window is
/// reachable. The drawer lives in its own window outside the app's React tree, so
/// this is what keeps its content clear of the notch and home indicator.
+ (UIEdgeInsets)appSafeAreaInsets;

@end

NS_ASSUME_NONNULL_END
