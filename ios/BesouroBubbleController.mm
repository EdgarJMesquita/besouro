#import "BesouroBubbleController.h"

#import "BesouroBubbleView.h"
#import "BesouroFileStore.h"
#import "BesouroWindows.h"

// Persisted bubble position (0–1 ratios of the draggable range), stored in the
// library's filesystem store — the same place readFile/writeFile use.
static NSString *const kBubblePositionFile = @"bubble-position.json";

static CGFloat const kBubbleSize   = 52;
static CGFloat const kBubbleMargin = 14;
// Default resting spot: right edge, 70% down — kept in sync with the Android
// default (BUBBLE_DEFAULT_VERTICAL_FRACTION).
static CGFloat const kBubbleDefaultVerticalFraction = 0.7;

// Idle dimming — after a spell without interaction the bubble fades to a low
// opacity so it stops competing for attention, and wakes to full on touch.
static CGFloat  const kBubbleIdleAlpha    = 0.4;   // opacity once idle
static NSTimeInterval const kBubbleIdleDelay = 8.0;   // idle seconds before dimming
static NSTimeInterval const kBubbleIdleFade  = 0.5;   // fade-out duration
static NSTimeInterval const kBubbleWakeFade  = 0.15;  // fade-in on touch (snappier)

// Parse a `#rgb` / `#rrggbb` string into a UIColor. Returns nil on malformed input.
static UIColor *BesouroColorFromHex(NSString *hex) {
  if (![hex isKindOfClass:[NSString class]]) return nil;
  NSString *s = [[hex stringByTrimmingCharactersInSet:
      [NSCharacterSet whitespaceAndNewlineCharacterSet]] uppercaseString];
  if ([s hasPrefix:@"#"]) s = [s substringFromIndex:1];
  if (s.length == 3) {
    // Expand shorthand (#abc → #aabbcc).
    unichar c[3];
    [s getCharacters:c range:NSMakeRange(0, 3)];
    s = [NSString stringWithFormat:@"%C%C%C%C%C%C", c[0], c[0], c[1], c[1], c[2], c[2]];
  }
  if (s.length != 6) return nil;
  unsigned int rgb = 0;
  if (![[NSScanner scannerWithString:s] scanHexInt:&rgb]) return nil;
  return [UIColor colorWithRed:((rgb >> 16) & 0xFF) / 255.0f
                         green:((rgb >> 8) & 0xFF) / 255.0f
                          blue:(rgb & 0xFF) / 255.0f
                         alpha:1.0f];
}

@interface BesouroBubbleController ()
@property (nonatomic, strong, nullable) UIWindow *bubbleWindow;
@property (nonatomic, weak, nullable) UIView *bubbleButton;
@property (nonatomic, assign) CGPoint bubbleRestingCenter;
@property (nonatomic, strong, nullable) NSTimer *bubbleIdleTimer;
// Cached bubble colors (from the JS theme/accent) so a color update that arrives
// before the bubble mounts is applied when it appears.
@property (nonatomic, strong, nullable) UIColor *bubbleFillColor;
@property (nonatomic, strong, nullable) UIColor *bubbleIconColor;
@end

@implementation BesouroBubbleController

- (void)dealloc {
  [_bubbleIdleTimer invalidate];
}

// ── Mounting ────────────────────────────────────────────────────────────────

- (BOOL)mountWithConfiguredTheme:(NSString *)configuredTheme
                 lightBackground:(NSString *)lightBackground
                       lightIcon:(NSString *)lightIcon
                  darkBackground:(NSString *)darkBackground
                        darkIcon:(NSString *)darkIcon {
  [self seedColorsFromDiskWithConfiguredTheme:configuredTheme
                              lightBackground:lightBackground
                                    lightIcon:lightIcon
                               darkBackground:darkBackground
                                     darkIcon:darkIcon];

  // Re-adopt an existing bubble after a reload. Fast Refresh / a full reload can
  // recreate the module instance while the bubble window (retained by the
  // singleton store) stays on screen — so its tap/pan gestures still target the
  // old, dead controller and nothing opens. Re-point them at the new `self`
  // instead of bailing out. Mirrors the Android install() re-wire.
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) {
      if (![window.accessibilityIdentifier isEqualToString:BesouroBubbleWindowIdentifier]) {
        continue;
      }
      for (UIView *subview in window.rootViewController.view.subviews) {
        if ([subview isKindOfClass:[BesouroBubbleView class]]) {
          [self attachGesturesToBubble:subview];
          [self applyCachedColorsToBubble:(BesouroBubbleView *)subview];
          self.bubbleButton = subview;
          self.bubbleWindow = window;
          // Re-arm idle dimming on the new instance (old timer died with it).
          subview.alpha = 1;
          [self scheduleIdleDim];
          break;
        }
      }
      return YES;
    }
  }

  UIWindowScene *activeScene = [BesouroWindows activeWindowScene];
  if (!activeScene) return NO;

  // Transparent full-screen pass-through window.
  BesouroPassthroughWindow *window =
      [[BesouroPassthroughWindow alloc] initWithWindowScene:activeScene];
  window.accessibilityIdentifier = BesouroBubbleWindowIdentifier;
  window.windowLevel = UIWindowLevelStatusBar - 1;
  window.backgroundColor = [UIColor clearColor];

  UIViewController *viewController = [UIViewController new];
  viewController.view.backgroundColor = [UIColor clearColor];
  window.rootViewController = viewController;
  window.hidden = NO;

  // Native draggable bubble — custom-drawn, no emoji dependency.
  CGRect screen = [UIScreen mainScreen].bounds;

  // Restore the last persisted spot, if any; otherwise use the default corner.
  CGFloat originX = screen.size.width - kBubbleSize - kBubbleMargin;
  CGFloat originY = screen.size.height * kBubbleDefaultVerticalFraction;
  CGFloat normalizedX = 0, normalizedY = 0;
  if ([self loadPersistedPositionX:&normalizedX y:&normalizedY]) {
    originX = MAX(0, MIN(normalizedX * (screen.size.width - kBubbleSize),
                         screen.size.width - kBubbleSize));
    originY = MAX(0, MIN(normalizedY * (screen.size.height - kBubbleSize),
                         screen.size.height - kBubbleSize));
  }

  BesouroBubbleView *bubble = [[BesouroBubbleView alloc] initWithFrame:CGRectMake(
    originX, originY, kBubbleSize, kBubbleSize
  )];

  [self attachGesturesToBubble:bubble];
  [self applyCachedColorsToBubble:bubble];

  [viewController.view addSubview:bubble];
  self.bubbleButton = bubble;

  // Mount animation — slide in from off the top-left corner to the resting spot.
  CGPoint restingCenter = bubble.center;
  bubble.center = CGPointMake(-kBubbleSize, -kBubbleSize);
  bubble.alpha = 0;
  [UIView animateWithDuration:0.5
                        delay:0.05
       usingSpringWithDamping:0.75
        initialSpringVelocity:0
                      options:UIViewAnimationOptionCurveEaseOut
                   animations:^{
    bubble.center = restingCenter;
    bubble.alpha = 1;
  } completion:^(BOOL finished) {
    [self scheduleIdleDim];
  }];

  [[BesouroWindowStore shared] retainWindow:window];
  self.bubbleWindow = window;
  return NO;
}

// ── Appearance ──────────────────────────────────────────────────────────────

- (void)applyAppearanceBackground:(NSString *)background iconColor:(NSString *)iconColor {
  UIColor *fill = BesouroColorFromHex(background);
  UIColor *icon = BesouroColorFromHex(iconColor);
  if (fill) self.bubbleFillColor = fill;
  if (icon) self.bubbleIconColor = icon;
  UIView *bubble = self.bubbleButton;
  if ([bubble isKindOfClass:[BesouroBubbleView class]]) {
    [self applyCachedColorsToBubble:(BesouroBubbleView *)bubble];
  }
}

// Resolve the bubble's colors from the settings file JS persists, so the entrance
// animation runs in the right theme rather than the built-in white. JS reads that
// file asynchronously and cannot have it in hand at mount, so it hands over both
// theme resolutions and the last step happens here: the stored theme name picks
// one — or the configured one when the user has stored none — the stored accent
// (when set) tints the icon, and anything unrecognized, `system` included,
// follows the device.
//
// Skipped once a push has landed: that is the live truth and this file may be a
// moment behind it.
- (void)seedColorsFromDiskWithConfiguredTheme:(NSString *)configuredTheme
                              lightBackground:(NSString *)lightBackground
                                    lightIcon:(NSString *)lightIcon
                               darkBackground:(NSString *)darkBackground
                                     darkIcon:(NSString *)darkIcon {
  if (self.bubbleFillColor || self.bubbleIconColor) return;

  NSDictionary<NSString *, NSString *> *stored = [BesouroFileStore readBubbleAppearance];
  NSString *theme = stored[@"theme"] ?: configuredTheme;
  BOOL dark;
  if ([theme isEqualToString:@"light"]) {
    dark = NO;
  } else if ([theme isEqualToString:@"dark"]) {
    dark = YES;
  } else {
    // Read the style off the scene rather than +currentTraitCollection, which is
    // only meaningful inside a UIKit view update (drawRect:, layoutSubviews, a
    // trait-change callback) — and this runs from a plain main-queue block.
    UIWindowScene *scene = [BesouroWindows activeWindowScene];
    UIUserInterfaceStyle style = scene ? scene.traitCollection.userInterfaceStyle
                                       : UITraitCollection.currentTraitCollection.userInterfaceStyle;
    dark = style == UIUserInterfaceStyleDark;
  }

  self.bubbleFillColor = BesouroColorFromHex(dark ? darkBackground : lightBackground);
  UIColor *accent = stored[@"accent"] ? BesouroColorFromHex(stored[@"accent"]) : nil;
  self.bubbleIconColor = accent ?: BesouroColorFromHex(dark ? darkIcon : lightIcon);
}

// Apply the cached theme/accent colors to a bubble view (no-op until a color has
// been pushed from JS — the view keeps its built-in defaults).
- (void)applyCachedColorsToBubble:(BesouroBubbleView *)bubble {
  if (self.bubbleFillColor) bubble.fillColor = self.bubbleFillColor;
  if (self.bubbleIconColor) bubble.iconColor = self.bubbleIconColor;
}

// ── Drawer choreography ──────────────────────────────────────────────────────

- (void)slideOffscreen {
  UIView *bubble = self.bubbleButton;
  if (!bubble) return;
  // No point dimming while parked offscreen; wake so it returns at full opacity.
  [self wakeFromIdle];
  self.bubbleRestingCenter = bubble.center;
  CGFloat parentWidth = bubble.superview.bounds.size.width;
  CGFloat halfWidth = bubble.bounds.size.width / 2;
  BOOL isOnLeft = bubble.center.x < parentWidth / 2;
  CGFloat offscreenX = isOnLeft ? -halfWidth : parentWidth + halfWidth;
  [UIView animateWithDuration:0.3
                        delay:0
                      options:UIViewAnimationOptionCurveEaseIn
                   animations:^{
    CGPoint center = bubble.center;
    center.x = offscreenX;
    bubble.center = center;
  } completion:nil];
}

- (void)returnToRestAnimated:(BOOL)animated {
  UIView *bubble = self.bubbleButton;
  if (!bubble) return;

  if (!animated) {
    [bubble.layer removeAllAnimations];
    bubble.center = self.bubbleRestingCenter;
    bubble.alpha = 1;
    [self scheduleIdleDim];
    return;
  }

  // Spring the bubble back to where it rested before the drawer opened.
  [UIView animateWithDuration:0.5
                        delay:0
       usingSpringWithDamping:0.6
        initialSpringVelocity:0
                      options:UIViewAnimationOptionCurveEaseOut
                   animations:^{
    bubble.center = self.bubbleRestingCenter;
  } completion:^(BOOL finished) {
    [self scheduleIdleDim];
  }];
}

// ── Idle dimming ────────────────────────────────────────────────────────────

// Arm the idle timer; the bubble dims once it fires without interruption.
- (void)scheduleIdleDim {
  [self.bubbleIdleTimer invalidate];
  self.bubbleIdleTimer = [NSTimer scheduledTimerWithTimeInterval:kBubbleIdleDelay
                                                          target:self
                                                        selector:@selector(dimForIdle)
                                                        userInfo:nil
                                                         repeats:NO];
}

- (void)dimForIdle {
  UIView *bubble = self.bubbleButton;
  if (!bubble) return;
  [UIView animateWithDuration:kBubbleIdleFade
                        delay:0
                      options:UIViewAnimationOptionCurveEaseOut |
                              UIViewAnimationOptionBeginFromCurrentState |
                              UIViewAnimationOptionAllowUserInteraction
                   animations:^{
    bubble.alpha = kBubbleIdleAlpha;
  } completion:nil];
}

// Cancel a pending dim and snap back to full opacity if currently dimmed.
- (void)wakeFromIdle {
  [self.bubbleIdleTimer invalidate];
  self.bubbleIdleTimer = nil;
  UIView *bubble = self.bubbleButton;
  if (!bubble || bubble.alpha >= 1.0) return;
  [UIView animateWithDuration:kBubbleWakeFade
                        delay:0
                      options:UIViewAnimationOptionCurveEaseOut |
                              UIViewAnimationOptionBeginFromCurrentState |
                              UIViewAnimationOptionAllowUserInteraction
                   animations:^{
    bubble.alpha = 1.0;
  } completion:nil];
}

// ── Gestures ────────────────────────────────────────────────────────────────

// (Re)attach fresh tap + pan recognizers targeting the current controller,
// removing any left over from a previous instance so they don't call a dead target.
- (void)attachGesturesToBubble:(UIView *)bubble {
  for (UIGestureRecognizer *recognizer in [bubble.gestureRecognizers copy]) {
    [bubble removeGestureRecognizer:recognizer];
  }
  UITapGestureRecognizer *tap =
      [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(bubbleTapped:)];
  [bubble addGestureRecognizer:tap];

  UIPanGestureRecognizer *pan =
      [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(bubblePanned:)];
  [bubble addGestureRecognizer:pan];
}

- (void)bubbleTapped:(UITapGestureRecognizer *)sender {
  UIView *bubble = sender.view;
  [self wakeFromIdle];
  // Quick press pulse, then open.
  [UIView animateWithDuration:0.1 animations:^{
    bubble.transform = CGAffineTransformMakeScale(0.9, 0.9);
  } completion:^(BOOL finished) {
    [UIView animateWithDuration:0.1 animations:^{
      bubble.transform = CGAffineTransformIdentity;
    }];
  }];
  if (self.onTap) self.onTap();
}

// Subtle scale-down while the bubble is held.
- (void)setBubble:(UIView *)bubble pressed:(BOOL)pressed {
  [UIView animateWithDuration:0.12
                        delay:0
                      options:UIViewAnimationOptionCurveEaseOut |
                              UIViewAnimationOptionAllowUserInteraction
                   animations:^{
    bubble.transform = pressed ? CGAffineTransformMakeScale(0.9, 0.9)
                               : CGAffineTransformIdentity;
  } completion:nil];
}

- (void)bubblePanned:(UIPanGestureRecognizer *)pan {
  UIView *bubble = pan.view;
  CGPoint translation = [pan translationInView:bubble.superview];

  if (pan.state == UIGestureRecognizerStateBegan) {
    [self wakeFromIdle];
    [self setBubble:bubble pressed:YES];
  }

  if (pan.state == UIGestureRecognizerStateBegan ||
      pan.state == UIGestureRecognizerStateChanged) {
    CGFloat halfWidth = bubble.bounds.size.width / 2;
    CGFloat halfHeight = bubble.bounds.size.height / 2;
    CGPoint center = bubble.center;
    center.x = MAX(halfWidth, MIN(center.x + translation.x,
                                  bubble.superview.bounds.size.width - halfWidth));
    center.y = MAX(halfHeight, MIN(center.y + translation.y,
                                   bubble.superview.bounds.size.height - halfHeight));
    bubble.center = center;
    [pan setTranslation:CGPointZero inView:bubble.superview];
  } else if (pan.state == UIGestureRecognizerStateEnded ||
             pan.state == UIGestureRecognizerStateCancelled) {
    [self setBubble:bubble pressed:NO];
    [self snapToEdge:bubble velocity:[pan velocityInView:bubble.superview]];
    [self scheduleIdleDim];
  }
}

// Snap to the nearest vertical edge, projecting the release momentum so a flick
// throws the bubble, then settling with a velocity-aware spring. Mirrors
// expo-dev-menu's calculateTargetPosition (momentum ≈ velocity/10).
- (void)snapToEdge:(UIView *)bubble velocity:(CGPoint)velocity {
  UIView *parent = bubble.superview;
  CGFloat parentWidth = parent.bounds.size.width;
  CGFloat parentHeight = parent.bounds.size.height;
  CGFloat halfWidth = bubble.bounds.size.width / 2;
  CGFloat halfHeight = bubble.bounds.size.height / 2;
  UIEdgeInsets safe = parent.safeAreaInsets;

  CGFloat projectedCenterX = bubble.center.x + velocity.x / 10.0;
  CGFloat targetX = projectedCenterX < parentWidth / 2
      ? halfWidth + kBubbleMargin + safe.left
      : parentWidth - halfWidth - kBubbleMargin - safe.right;
  CGFloat minY = halfHeight + kBubbleMargin + safe.top;
  CGFloat maxY = parentHeight - halfHeight - kBubbleMargin - safe.bottom;
  CGFloat targetY = MAX(minY, MIN(bubble.center.y + velocity.y / 10.0, maxY));
  CGPoint target = CGPointMake(targetX, targetY);

  // Normalise the throw speed into the spring's initial velocity (1/points).
  CGFloat distance = hypot(target.x - bubble.center.x, target.y - bubble.center.y);
  CGFloat speed = hypot(velocity.x, velocity.y);
  CGFloat initialVelocity = distance > 1 ? MIN(speed / distance, 20.0) : 0;

  [UIView animateWithDuration:0.65
                        delay:0
       usingSpringWithDamping:0.65
        initialSpringVelocity:initialVelocity
                      options:UIViewAnimationOptionCurveEaseOut |
                              UIViewAnimationOptionAllowUserInteraction
                   animations:^{
    bubble.center = target;
  } completion:nil];

  [self persistPosition:target
               inParent:parent.bounds.size
             bubbleSize:bubble.bounds.size];
}

// ── Position persistence ────────────────────────────────────────────────────
// Reuses the library's filesystem store rather than NSUserDefaults, so all
// persistence lives in one place (and the saved position is visible in the File
// System inspector). Stored as 0–1 ratios of the draggable range so it survives
// restarts and screen-size/rotation changes. Mirrors the Android side.

- (void)persistPosition:(CGPoint)center
               inParent:(CGSize)parent
             bubbleSize:(CGSize)size {
  CGFloat rangeX = parent.width - size.width;
  CGFloat rangeY = parent.height - size.height;
  if (rangeX <= 0 || rangeY <= 0) return;
  CGFloat normalizedX = MAX(0, MIN((center.x - size.width / 2) / rangeX, 1));
  CGFloat normalizedY = MAX(0, MIN((center.y - size.height / 2) / rangeY, 1));
  NSString *json = [NSString stringWithFormat:@"{\"x\":%f,\"y\":%f}", normalizedX, normalizedY];
  [BesouroFileStore writeFile:kBubblePositionFile content:json error:nil];
}

- (BOOL)loadPersistedPositionX:(CGFloat *)outX y:(CGFloat *)outY {
  NSData *data = [NSData dataWithContentsOfFile:
      [BesouroFileStore pathForFilename:kBubblePositionFile]];
  if (!data) return NO;
  NSDictionary *position = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![position isKindOfClass:[NSDictionary class]]) return NO;
  NSNumber *x = position[@"x"];
  NSNumber *y = position[@"y"];
  if (![x isKindOfClass:[NSNumber class]] || ![y isKindOfClass:[NSNumber class]]) return NO;
  *outX = x.doubleValue;
  *outY = y.doubleValue;
  return YES;
}

@end
