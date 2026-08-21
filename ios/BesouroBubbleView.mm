#import "BesouroBubbleView.h"

@implementation BesouroBubbleView

- (instancetype)initWithFrame:(CGRect)frame {
  self = [super initWithFrame:frame];
  if (self) {
    // Transparent background — the white circle is drawn in drawRect: so it is
    // always perfectly clipped to the oval without needing masksToBounds.
    // masksToBounds = NO lets the shadow render outside the view's bounds.
    self.backgroundColor = [UIColor clearColor];
    self.layer.shadowColor  = [UIColor blackColor].CGColor;
    self.layer.shadowOpacity = 0.18f;
    self.layer.shadowRadius  = 6;
    self.layer.shadowOffset  = CGSizeMake(0, 3);
    // Defaults — overridden live to match the drawer theme/accent.
    _fillColor = [UIColor colorWithRed:1 green:1 blue:1 alpha:1];
    _iconColor = [UIColor colorWithRed:37.0f / 255.0f green:99.0f / 255.0f blue:235.0f / 255.0f alpha:1.0f];
  }
  return self;
}

- (void)setFillColor:(UIColor *)fillColor {
  _fillColor = fillColor ?: [UIColor colorWithRed:1 green:1 blue:1 alpha:1];
  [self setNeedsDisplay];
}

- (void)setIconColor:(UIColor *)iconColor {
  _iconColor = iconColor ?: [UIColor colorWithRed:37.0f / 255.0f green:99.0f / 255.0f blue:235.0f / 255.0f alpha:1.0f];
  [self setNeedsDisplay];
}

- (void)layoutSubviews {
  [super layoutSubviews];
  // Explicit shadow path avoids the expensive per-pixel mask computation and
  // keeps the correct oval shape when the frame changes.
  self.layer.shadowPath = [UIBezierPath bezierPathWithOvalInRect:self.bounds].CGPath;
}

- (void)drawRect:(CGRect)rect {
  CGContextRef ctx = UIGraphicsGetCurrentContext();
  if (!ctx) return;

  // ── Background circle ──────────────────────────────────────────────────────
  UIBezierPath *circle = [UIBezierPath bezierPathWithOvalInRect:rect];
  [self.fillColor setFill];
  [circle fill];
  // Accent halo — a translucent ring in the icon/accent color so the flat fill
  // gains some depth (mirrors Android's ringColorFor / expo-dev-menu's FAB border).
  CGFloat ringWidth = 2.0;
  UIColor *ringColor = [self.iconColor colorWithAlphaComponent:0.30];
  // The stroke straddles the path, so inset by half its width to keep it inside.
  UIBezierPath *ring = [UIBezierPath
      bezierPathWithOvalInRect:CGRectInset(rect, ringWidth / 2.0, ringWidth / 2.0)];
  ring.lineWidth = ringWidth;
  [ringColor setStroke];
  [ring stroke];

  // ── Bug icon ───────────────────────────────────────────────────────────────
  CGFloat w = rect.size.width;
  CGFloat h = rect.size.height;
  // Icon occupies 52 % of the bubble diameter, centred. Nudge down slightly so
  // the antenna-heavy top optically centres (matches Android ICON_VERTICAL_NUDGE).
  CGFloat s  = w * 0.52f;
  CGFloat ox = (w - s) / 2.0f;
  CGFloat oy = (h - s) / 2.0f + s * 0.06f;

  // Bug color — the theme accent.
  CGFloat br = 0, bg_ = 0, bb = 0, ba = 0;
  [self.iconColor getRed:&br green:&bg_ blue:&bb alpha:&ba];
  CGContextSetRGBStrokeColor(ctx, br, bg_, bb, 1.0);
  CGContextSetLineCap(ctx, kCGLineCapRound);

  CGFloat barThickness = MAX(1.5f, s * 0.07f);
  CGFloat barHalfW     = s * 0.38f;

  // Legs — 2 pairs of rotated line segments (body drawn on top hides centres)
  CGContextSetLineWidth(ctx, barThickness);
  [self drawLegPairInContext:ctx
                         cx:ox + s * 0.5f cy:oy + s * 0.34f + barThickness / 2.0f
                      halfW:barHalfW angle:18.0f];
  [self drawLegPairInContext:ctx
                         cx:ox + s * 0.5f cy:oy + s * 0.52f + barThickness / 2.0f
                      halfW:barHalfW angle:10.0f];

  // Antennae — thin, angled outward from the head
  CGContextSetLineWidth(ctx, MAX(1.5f, s * 0.06f));
  CGFloat antCY = oy + s * 0.14f;
  [self drawRotatedSegmentInContext:ctx cx:ox + s * 0.39f cy:antCY halfH:s * 0.08f angle: 25.0f];
  [self drawRotatedSegmentInContext:ctx cx:ox + s * 0.61f cy:antCY halfH:s * 0.08f angle:-25.0f];

  // Body — capsule, drawn last so it covers the leg crossings
  CGContextSetRGBFillColor(ctx, br, bg_, bb, 1.0);
  UIBezierPath *body = [UIBezierPath
      bezierPathWithRoundedRect:CGRectMake(ox + s * 0.25f, oy + s * 0.18f, s * 0.50f, s * 0.62f)
                   cornerRadius:s * 0.25f];
  [body fill];
}

// Draws two symmetric line segments rotated ±angleDeg from horizontal, centred at (cx, cy).
- (void)drawLegPairInContext:(CGContextRef)ctx
                          cx:(CGFloat)cx cy:(CGFloat)cy
                       halfW:(CGFloat)halfW angle:(CGFloat)deg {
  for (int sign = -1; sign <= 1; sign += 2) {
    CGFloat theta = deg * sign * (CGFloat)M_PI / 180.0f;
    CGFloat c = cosf(theta), s = sinf(theta);
    CGContextMoveToPoint(ctx,    cx - halfW * c, cy - halfW * s);
    CGContextAddLineToPoint(ctx, cx + halfW * c, cy + halfW * s);
  }
  CGContextStrokePath(ctx);
}

// Draws a vertical segment of length 2*halfH rotated angleDeg degrees, centred at (cx, cy).
- (void)drawRotatedSegmentInContext:(CGContextRef)ctx
                                 cx:(CGFloat)cx cy:(CGFloat)cy
                              halfH:(CGFloat)halfH angle:(CGFloat)deg {
  CGFloat theta = deg * (CGFloat)M_PI / 180.0f;
  CGFloat s = sinf(theta), c = cosf(theta);
  CGContextMoveToPoint(ctx,    cx + halfH * s, cy - halfH * c);
  CGContextAddLineToPoint(ctx, cx - halfH * s, cy + halfH * c);
  CGContextStrokePath(ctx);
}

@end
