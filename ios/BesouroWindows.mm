#import "BesouroWindows.h"

NSString *const BesouroBubbleWindowIdentifier = @"RNBesouroBubbleWindow";
NSString *const BesouroWindowIdentifier       = @"RNBesouroWindow";
NSString *const BesouroPickWindowIdentifier   = @"RNBesouroPickWindow";

// ─── Pass-through window ────────────────────────────────────────────────────

@implementation BesouroPassthroughWindow
- (UIView *)hitTest:(CGPoint)point withEvent:(UIEvent *)event {
  UIView *hit = [super hitTest:point withEvent:event];
  // Pass through: nothing hit, hit the window itself, or only the transparent
  // full-screen container view (no interactive child claimed the touch).
  if (hit == nil || hit == self || hit == self.rootViewController.view) return nil;
  return hit;
}
@end

// ─── Window retention ───────────────────────────────────────────────────────

@interface BesouroWindowStore ()
@property (nonatomic, strong) NSMutableArray<UIWindow *> *windows;
@end

@implementation BesouroWindowStore

+ (instancetype)shared {
  static BesouroWindowStore *instance;
  static dispatch_once_t token;
  dispatch_once(&token, ^{ instance = [BesouroWindowStore new]; });
  return instance;
}

- (instancetype)init {
  self = [super init];
  _windows = [NSMutableArray new];
  return self;
}

- (void)retainWindow:(UIWindow *)window {
  if (window) [self.windows addObject:window];
}

- (void)releaseWindow:(UIWindow *)window {
  if (!window) return;
  window.hidden = YES;
  [self.windows removeObject:window];
}

- (NSArray<UIWindow *> *)windowsWithIdentifier:(NSString *)identifier {
  NSMutableArray<UIWindow *> *matches = [NSMutableArray new];
  for (UIWindow *window in [self.windows copy]) {
    if ([window.accessibilityIdentifier isEqualToString:identifier]) {
      [matches addObject:window];
    }
  }
  return matches;
}

@end

// ─── Window lookups ─────────────────────────────────────────────────────────

@implementation BesouroWindows

+ (UIWindowScene *)activeWindowScene {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if ([scene isKindOfClass:[UIWindowScene class]] &&
        scene.activationState == UISceneActivationStateForegroundActive) {
      return (UIWindowScene *)scene;
    }
  }
  return nil;
}

+ (UIWindowScene *)overlayWindowScene {
  UIWindow *bubbleWindow = [[BesouroWindowStore shared]
      windowsWithIdentifier:BesouroBubbleWindowIdentifier].firstObject;
  return bubbleWindow.windowScene ?: [self activeWindowScene];
}

+ (UIView *)appRootView {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      NSString *identifier = window.accessibilityIdentifier;
      if ([identifier isEqualToString:BesouroBubbleWindowIdentifier] ||
          [identifier isEqualToString:BesouroWindowIdentifier] ||
          [identifier isEqualToString:BesouroPickWindowIdentifier]) {
        continue;
      }
      if (window.rootViewController.view) return window.rootViewController.view;
    }
  }
  return nil;
}

+ (UIWindow *)appKeyWindow {
  UIWindowScene *scene = [self activeWindowScene];
  if (!scene) return nil;
  if (@available(iOS 15.0, *)) {
    if (scene.keyWindow) return scene.keyWindow;
  }
  for (UIWindow *window in scene.windows) {
    if (window.isKeyWindow) return window;
  }
  return scene.windows.firstObject;
}

+ (UIEdgeInsets)appSafeAreaInsets {
  UIWindow *window = [self appRootView].window ?: [self appKeyWindow];
  return window ? window.safeAreaInsets : UIEdgeInsetsZero;
}

@end
