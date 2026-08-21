#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// ─── Bubble view ─────────────────────────────────────────────────────────────
// White circle with a custom-drawn blue bug icon, mirroring the Android
// DraggableBubbleView.onDraw() implementation (same proportions and colours).
// Drawing only — mounting, gestures and idle dimming live in
// BesouroBubbleController.

@interface BesouroBubbleView : UIView
/** Circle fill color. Defaults to white. */
@property (nonatomic, strong) UIColor *fillColor;
/** Bug-icon tint. Defaults to #2563EB. */
@property (nonatomic, strong) UIColor *iconColor;
@end

NS_ASSUME_NONNULL_END
