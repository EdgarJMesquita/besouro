#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// ─── Bubble controller ──────────────────────────────────────────────────────
// Owns the floating bubble: its window, gestures, drag/snap physics, idle
// dimming, theme colors and persisted position. It knows nothing about the
// drawer — a tap is reported through `onTap`, and the drawer's open/close
// choreography drives it through `slideOffscreen` / `returnToRestAnimated:`.
//
// Every method is main thread only; the module does the hopping.

@interface BesouroBubbleController : NSObject

/// Fired on the main thread when the bubble is tapped.
@property (nonatomic, copy, nullable) void (^onTap)(void);

/// Mounts the bubble, or re-adopts one left on screen by a previous module
/// instance (Fast Refresh / dev reload) by re-pointing its gestures at self.
///
/// Takes both of the drawer's theme resolutions (`#rrggbb`, already resolved from
/// the configured options) rather than one pair: the bubble must be painted
/// before its entrance animation, and JS has not read the persisted settings by
/// then. So the last step happens here — the stored theme and accent are read off
/// disk and decide which pair the bubble wears. `configuredTheme` is what to wear
/// when nothing is stored: the host app's theme, or `system` to follow the device.
///
/// Returns YES when it re-adopted rather than mounted — the caller's cue that
/// the previous instance may also have left a surface window behind.
- (BOOL)mountWithConfiguredTheme:(NSString *)configuredTheme
                 lightBackground:(NSString *)lightBackground
                       lightIcon:(NSString *)lightIcon
                  darkBackground:(NSString *)darkBackground
                        darkIcon:(NSString *)darkIcon;

/// Recolors the bubble to match the drawer theme/accent. Both are `#rgb` or
/// `#rrggbb`; malformed values are ignored. Colors are cached, so a call that
/// lands before the bubble mounts still takes effect on mount.
- (void)applyAppearanceBackground:(NSString *)background iconColor:(NSString *)iconColor;

/// Slides the bubble fully off its nearest edge, remembering where it rested.
- (void)slideOffscreen;

/// Returns the bubble to its remembered resting spot. Animated for a drawer
/// close; instant for a reload teardown, where the bubble must be back in place
/// before the surface is recreated.
- (void)returnToRestAnimated:(BOOL)animated;

@end

NS_ASSUME_NONNULL_END
