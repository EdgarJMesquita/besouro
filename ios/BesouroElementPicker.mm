#import "BesouroElementPicker.h"

#import "BesouroWindows.h"

#if RCT_NEW_ARCH_ENABLED
#import <React/RCTComponentViewProtocol.h>
#endif

// The one bit of RN's `RCTComponent` protocol the element pick needs. Declared
// here rather than imported: the header is old-architecture-only, so importing it
// would break new-arch-only builds, and `-performSelector:` on an unknown selector
// trips ARC's return-type warning. Views that don't respond to it (every Fabric
// component view) fall back to `UIView.tag`.
@protocol BesouroReactTagged <NSObject>
@property (nonatomic, copy, readonly) NSNumber *reactTag;
@end

@interface BesouroElementPicker ()
// The transparent capture window and the one-shot JS callback that fires with
// the tapped point.
@property (nonatomic, strong, nullable) UIWindow *pickWindow;
@property (nonatomic, copy, nullable) RCTResponseSenderBlock pickResult;
@end

@implementation BesouroElementPicker

- (void)startWithResult:(RCTResponseSenderBlock)onResult {
  // Drop any stale pick.
  [self discard];

  UIWindowScene *scene = [BesouroWindows overlayWindowScene];
  if (!scene) {
    onResult(@[@(0), @(0), @(0)]);
    return;
  }

  UIWindow *capture = [[UIWindow alloc] initWithWindowScene:scene];
  capture.accessibilityIdentifier = BesouroPickWindowIdentifier;
  capture.windowLevel = UIWindowLevelAlert + 1;
  capture.backgroundColor = [UIColor clearColor];
  UIViewController *viewController = [UIViewController new];
  viewController.view.backgroundColor = [UIColor clearColor];
  capture.rootViewController = viewController;

  UITapGestureRecognizer *tap =
      [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(pickTapped:)];
  [viewController.view addGestureRecognizer:tap];

  self.pickResult = onResult;
  self.pickWindow = capture;
  [[BesouroWindowStore shared] retainWindow:capture];
  capture.hidden = NO;
}

- (void)discard {
  [[BesouroWindowStore shared] releaseWindow:self.pickWindow];
  self.pickWindow = nil;
}

- (void)pickTapped:(UITapGestureRecognizer *)sender {
  RCTResponseSenderBlock callback = self.pickResult;
  self.pickResult = nil;

  // Convert the window-space tap into the app root view's coordinates so it lines
  // up with what the renderer hit-tests. Both windows share the screen space, so
  // `fromView:nil` (window base coords) is a valid bridge between them.
  CGPoint inWindow = [sender locationInView:nil];
  UIView *appRoot = [BesouroWindows appRootView];
  CGPoint point = appRoot ? [appRoot convertPoint:inWindow fromView:nil] : inWindow;

  // Drop the capture window before hit-testing. `appRootView` already excludes it
  // (and the bubble/drawer), so this is belt-and-braces rather than load-bearing.
  [self discard];

  NSMutableArray *path = [NSMutableArray array];
  if (appRoot) {
    [self collectHitPath:path inView:appRoot atPoint:point origin:CGPointZero];
  }

  // rootTag 0 → JS falls back to the first React root (correct for single-root apps).
  if (callback) callback(@[@(point.x), @(point.y), @(0), path]);
}

// Append the chain of views under `point` — `view` first, deepest hit last — each
// described by `describeView:origin:`.
//
// Deliberately not `-hitTest:withEvent:`. That skips views with
// `userInteractionEnabled == NO`, which is why RN's own `-reactTagAtPoint:` has to
// hit-test and then walk *up* to the nearest React view — it resolves a nested
// plain <View> to whichever ancestor happens to be touchable. For an inspector we
// want the view actually under the finger, so we descend on geometry instead.
//
// `origin` is the running position of `view` in the root's coordinate space, so
// reported bounds are absolute rather than parent-relative.
- (void)collectHitPath:(NSMutableArray *)path
                inView:(UIView *)view
               atPoint:(CGPoint)point
                origin:(CGPoint)origin {
  [path addObject:[self describeView:view origin:origin]];

  // Reverse order: the last subview is drawn on top, so it wins the hit.
  for (UIView *subview in view.subviews.reverseObjectEnumerator) {
    if (subview.hidden || subview.alpha < 0.01) continue;
    CGPoint local = [view convertPoint:point toView:subview];
    if (![subview pointInside:local withEvent:nil]) continue;
    // `bounds.origin` is the parent's scroll offset; subtract it so a scrolled
    // container reports its children where they actually appear.
    CGPoint subviewOrigin = CGPointMake(origin.x + subview.frame.origin.x - view.bounds.origin.x,
                                        origin.y + subview.frame.origin.y - view.bounds.origin.y);
    [self collectHitPath:path inView:subview atPoint:local origin:subviewOrigin];
    return;
  }
}

// The React tag for `view`, or 0 when React doesn't own it.
//
// Two sources, and neither can be trusted blindly. On the old architecture the tag
// is `reactTag` — but that's a *category on UIView*, so every view responds to the
// selector and non-React views simply return nil. On Fabric it's plain `UIView.tag`
// (RCTComponentViewRegistry sets it on mount, resets it to 0 on recycle) — but
// `tag` is a stock UIKit property any view may carry for unrelated reasons, so
// reading it off a non-component view would invent a tag that collides with a real
// one. Hence: trust `reactTag` when non-nil, then `tag` only on views that are
// actually Fabric component views, else 0.
- (NSInteger)reactTagForView:(UIView *)view {
  if ([view respondsToSelector:@selector(reactTag)]) {
    NSNumber *tag = [(id<BesouroReactTagged>)view reactTag];
    if (tag != nil) return tag.integerValue;
  }
#if RCT_NEW_ARCH_ENABLED
  if ([view conformsToProtocol:@protocol(RCTComponentViewProtocol)]) {
    return view.tag;
  }
#endif
  return 0;
}

// One entry of the pick path. Views React doesn't own report tag 0 — the signal to
// JS that no fiber will match. `testID` lands on `accessibilityIdentifier`, and is
// the only human-readable identity available when the fiber tree isn't reachable
// (release builds without the DevTools hook).
- (NSDictionary *)describeView:(UIView *)view origin:(CGPoint)origin {
  NSInteger reactTag = [self reactTagForView:view];
  NSString *testID = view.accessibilityIdentifier ?: @"";
  return @{
    @"tag" : @(reactTag),
    @"className" : NSStringFromClass(view.class),
    @"testID" : testID,
    @"left" : @(origin.x),
    @"top" : @(origin.y),
    @"width" : @(view.bounds.size.width),
    @"height" : @(view.bounds.size.height),
  };
}

@end
