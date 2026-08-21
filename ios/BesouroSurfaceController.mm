#import "BesouroSurfaceController.h"

#import "BesouroWindows.h"

#import <objc/runtime.h>

#if __has_include(<React_RCTAppDelegate/RCTRootViewFactory.h>)
#import <React_RCTAppDelegate/RCTRootViewFactory.h> // use_frameworks! (module name sanitized)
#else
#import <React-RCTAppDelegate/RCTRootViewFactory.h>
#endif
#if RCT_NEW_ARCH_ENABLED
#import <ReactCommon/RCTHost.h>
#import <React/RCTFabricSurface.h>
#else
#import <React/RCTRootView.h>
#endif

// The AppRegistry key the JS drawer registers under (src/core/besouro-registry-key.ts).
static NSString *const kBesouroRegistryKey = @"RNBesouro";

@interface BesouroSurfaceController ()
@property (nonatomic, strong, nullable) UIWindow *surfaceWindow;
// `RCTFabricSurface` on the New Architecture, unused on the legacy renderer.
// Held as `id` so the header stays architecture-agnostic.
@property (nonatomic, strong, nullable) id surface;
@end

@implementation BesouroSurfaceController

// ── Open / close ────────────────────────────────────────────────────────────

- (void)open {
  if (self.surfaceWindow) return;

  UIView *surfaceView = [self createSurfaceView];
  if (!surfaceView) return;

  // Slide the bubble fully off its nearest edge as the drawer opens.
  if (self.onWillOpen) self.onWillOpen();

  UIWindowScene *activeScene = [BesouroWindows overlayWindowScene];
  CGRect screenBounds = activeScene.coordinateSpace.bounds;

  // Tell the Fabric surface its full-screen size so React can lay out the
  // Drawer: left-side dismissable backdrop (flex:1) + right-side drawer.
  surfaceView.frame = screenBounds;
  surfaceView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
#if RCT_NEW_ARCH_ENABLED
  [(RCTFabricSurface *)self.surface setSize:screenBounds.size];
#endif

  UIViewController *viewController = [UIViewController new];
  viewController.view = surfaceView;

  UIWindow *surfaceWindow = [[UIWindow alloc] initWithWindowScene:activeScene];
  surfaceWindow.accessibilityIdentifier = BesouroWindowIdentifier;
  surfaceWindow.windowLevel = UIWindowLevelAlert;
  surfaceWindow.rootViewController = viewController;
  surfaceWindow.hidden = NO;

  [[BesouroWindowStore shared] retainWindow:surfaceWindow];
  self.surfaceWindow = surfaceWindow;
}

- (void)close {
  [[BesouroWindowStore shared] releaseWindow:self.surfaceWindow];
  self.surfaceWindow = nil;

  // Spring the bubble back to where it rested before the drawer opened.
  if (self.onDidClose) self.onDidClose(YES);

  [self stopSurface];
}

- (void)setFrame:(CGRect)frame {
  UIWindow *window = self.surfaceWindow;
  if (!window) return;

  window.frame = frame;
  // The window's root view is the surface view itself (see -open), so it is
  // re-framed to the window's own bounds rather than to the screen.
  window.rootViewController.view.frame = CGRectMake(0, 0, frame.size.width, frame.size.height);
#if RCT_NEW_ARCH_ENABLED
  [(RCTFabricSurface *)self.surface setSize:frame.size];
#endif
}

- (void)resetFrame {
  UIWindowScene *scene = self.surfaceWindow.windowScene ?: [BesouroWindows overlayWindowScene];
  if (!scene) return;
  [self setFrame:scene.coordinateSpace.bounds];
}

- (void)teardownForReload {
  UIWindow *window = self.surfaceWindow;
  self.surfaceWindow = nil;
  if (window) {
    [[BesouroWindowStore shared] releaseWindow:window];
    // The bubble was slid off-screen when the drawer opened. Snap it back to its
    // resting spot so the reload re-adopts a visible bubble, not one parked off
    // the edge.
    if (self.onDidClose) self.onDidClose(NO);
  }
  [self stopSurface];
}

- (void)discardOrphanedWindows {
  BesouroWindowStore *store = [BesouroWindowStore shared];
  for (UIWindow *window in [store windowsWithIdentifier:BesouroWindowIdentifier]) {
    [store releaseWindow:window];
  }
  self.surfaceWindow = nil;
  self.surface = nil;
}

- (void)stopSurface {
#if RCT_NEW_ARCH_ENABLED
  [(RCTFabricSurface *)self.surface stop];
#endif
  self.surface = nil;
}

// ── Surface creation ────────────────────────────────────────────────────────

- (UIView *)createSurfaceView {
  RCTRootViewFactory *rootViewFactory = [self rootViewFactory];
  NSLog(@"[Besouro] rootViewFactory=%@", rootViewFactory);
  if (!rootViewFactory) return nil;

#if RCT_NEW_ARCH_ENABLED
  RCTHost *host = rootViewFactory.reactHost;
  if (!host) return nil;
  RCTFabricSurface *surface = [host createSurfaceWithModuleName:kBesouroRegistryKey
                                              initialProperties:@{}];
  self.surface = surface;
  return (UIView *)surface.view;
#else
  RCTBridge *bridge = rootViewFactory.bridge ?: self.bridge;
  if (!bridge) return nil;
  return [[RCTRootView alloc] initWithBridge:bridge
                                  moduleName:kBesouroRegistryKey
                           initialProperties:@{}];
#endif
}

// Returns the RCTRootViewFactory held by the app delegate.
// Covers three patterns:
//   1. Standard RN app: AppDelegate extends RCTAppDelegate → exposes rootViewFactory as ObjC method.
//   2. New factory pattern: AppDelegate holds reactNativeFactory as an ObjC property.
//   3. Expo / Swift AppDelegate: reactNativeFactory is a Swift stored property (no @objc);
//      accessed via ObjC runtime ivar lookup.
- (id)rootViewFactory {
  id appDelegate = UIApplication.sharedApplication.delegate;

  // Pattern 1 — RCTAppDelegate.rootViewFactory (ObjC method)
  if ([appDelegate respondsToSelector:@selector(rootViewFactory)]) {
    return [appDelegate performSelector:@selector(rootViewFactory)];
  }

  // Pattern 2 & 3 — appDelegate.reactNativeFactory.rootViewFactory
  //
  // `reactNativeFactory` is deliberately undeclared here: it is a property of
  // RCTAppDelegate, and importing that header to name it would tie this file to
  // a base class the host app is not required to use — the very assumption the
  // three-pattern probe exists to avoid. The selector is only ever sent after a
  // -respondsToSelector: check, so an app delegate without it is handled.
  id reactNativeFactory = nil;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wundeclared-selector"
  if ([appDelegate respondsToSelector:@selector(reactNativeFactory)]) {
    reactNativeFactory = [appDelegate performSelector:@selector(reactNativeFactory)];
  }
#pragma clang diagnostic pop
  // Swift stored properties have no @objc accessor; read the ivar directly.
  if (!reactNativeFactory) {
    Ivar ivar = class_getInstanceVariable([appDelegate class], "reactNativeFactory");
    if (ivar) reactNativeFactory = object_getIvar(appDelegate, ivar);
  }
  if ([reactNativeFactory respondsToSelector:@selector(rootViewFactory)]) {
    return [reactNativeFactory performSelector:@selector(rootViewFactory)];
  }

  return nil;
}

@end
