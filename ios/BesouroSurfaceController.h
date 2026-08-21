#import <UIKit/UIKit.h>

@class RCTBridge;

NS_ASSUME_NONNULL_BEGIN

// ─── Surface controller ─────────────────────────────────────────────────────
// Owns the drawer's window and the React surface inside it — the `RNBesouro`
// root the JS drawer registers under. Finds the host app's RCTRootViewFactory to
// build that surface, and tears it down deterministically on a dev reload.
//
// It knows nothing about the bubble: the choreography of sliding it out of the
// way and springing it back is driven through `onWillOpen` / `onDidClose`.
//
// Every method is main thread only; the module does the hopping. Creating the
// surface asserts on the main queue (`-[RCTFabricSurface view]`), so this is not
// merely a convention.

@interface BesouroSurfaceController : NSObject

/// The old-architecture fallback for surface creation, when the app delegate's
/// root view factory has no bridge of its own. Unused on the New Architecture.
@property (nonatomic, weak, nullable) RCTBridge *bridge;

/// The drawer's window while it is open, else nil. Read by the share sheet, which
/// prefers to present above the drawer it was launched from.
@property (nonatomic, strong, readonly, nullable) UIWindow *surfaceWindow;

/// Fired once the surface exists and is about to be shown.
@property (nonatomic, copy, nullable) void (^onWillOpen)(void);

/// Fired after the drawer's window is gone. `animated` is NO for a reload teardown,
/// where the bubble must be back in place before the surface is recreated.
@property (nonatomic, copy, nullable) void (^onDidClose)(BOOL animated);

/// Mounts the surface in its own window. No-op when already open, and a
/// silent no-op when no root view factory or host is reachable.
- (void)open;

/// Dismisses the window and stops its surface.
- (void)close;

/// SPIKE — shrink the drawer's window to a floating rect, in points, in the
/// scene's coordinate space. A `UIWindow` smaller than the screen passes every
/// touch outside it through to the app below with no hit-test override, which is
/// what makes a minimized, movable panel possible at all. The Fabric surface is
/// resized to match so React lays out to the new bounds. No-op when closed.
- (void)setFrame:(CGRect)frame;

/// SPIKE — put the drawer's window back to full-screen. No-op when closed.
- (void)resetFrame;

/// Tears the drawer down while the RCTHost is still alive. The drawer is a Fabric
/// surface bound to that host; on a full reload the host and its surface
/// presenter go away, but the window is retained by the singleton store
/// and would keep the surface mounted — a use-after-free that crashes if the
/// drawer was open.
- (void)teardownForReload;

/// Drops any drawer window left behind by a previous module instance, so a
/// re-wired bubble opens a fresh drawer instead of hitting a stale guard.
- (void)discardOrphanedWindows;

@end

NS_ASSUME_NONNULL_END
