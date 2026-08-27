#import "BesouroViewTreeSnapshot.h"

#import "BesouroWindows.h"

#if RCT_NEW_ARCH_ENABLED
#import <React/RCTComponentViewProtocol.h>
#endif

// Same one-property shim `BesouroElementPicker.mm` declares, for the same reason:
// `RCTComponent.h` is old-architecture-only, so importing it would break
// new-arch-only builds.
//
// NOTE: this and `-reactTagForView:` below are copied from the picker. The tag
// read belongs in one shared helper both call — two copies is exactly how the
// wireframe and the picker start disagreeing about which view is which.
@protocol BesouroReactTagged <NSObject>
@property (nonatomic, copy, readonly) NSNumber *reactTag;
@end

// Duck-typing shim for reading a view's text. Declared rather than imported for
// the same reason as the tag above, and `@optional` because nothing implements
// this protocol — it exists only to give `-respondsToSelector:` checks a typed
// call site instead of `-performSelector:`.
@protocol BesouroTextBearing <NSObject>
@optional
@property (nonatomic, copy, readonly) NSString *text;
@property (nonatomic, copy, readonly) NSAttributedString *attributedText;
// The subview a view hands its drawing to, when it uses that arrangement.
// UITableViewCell, UIVisualEffectView and RN's paragraph view all have one.
@property (nonatomic, strong, readonly) UIView *contentView;
// Style, for replicating a text's appearance in the wireframe.
@property (nonatomic, strong, readonly) UIFont *font;
@property (nonatomic, readonly) NSTextAlignment textAlignment;
@end

// Where the walk gives up.
//
// A ceiling, not a budget. The job is to draw the screen as it is, so this sits
// far above any tree that could be one: a measured screen is ~120 views at ~19KB
// and ~5ms, so 50k is three orders of magnitude of headroom and still bounded —
// a devtool must not hang the app it is inspecting, and an unbounded walk over a
// corrupt or cyclic view graph would.
//
// Reaching it is reported rather than hidden: what comes back is a valid prefix
// of the tree, and `truncated` says so on the payload.
static const NSUInteger BesouroMaxSnapshotNodes = 50000;

// Cap on a captured string. Long enough to recognise a label, short enough that a
// screen full of paragraphs can't turn the payload into the thing we measured it
// to avoid being.
static const NSUInteger BesouroMaxSnapshotText = 120;

// A number `NSJSONSerialization` will accept — 0 for anything it will not.
//
// It rejects NaN and infinities outright and returns nil for the *whole* payload,
// so one view with a broken frame — a NaN width, an infinite corner radius —
// would turn a two-hundred-node capture into the empty fallback in `captureJSON`,
// which the tab can only draw as a blank stage. Losing one node is the trade.
static NSNumber *BesouroJSONNumber(CGFloat value) {
  return @(isfinite(value) ? value : 0);
}

@implementation BesouroViewTreeSnapshot

+ (NSString *)captureJSON {
  UIView *root = [BesouroWindows appRootView];
  NSMutableArray<NSDictionary *> *nodes = [NSMutableArray array];
  BOOL complete = YES;
  if (root) {
    complete = [self collect:root depth:0 origin:CGPointZero parent:-1 into:nodes];
  }

  NSDictionary *payload = @{
    @"nodes" : nodes,
    @"width" : BesouroJSONNumber(root ? root.bounds.size.width : 0),
    @"height" : BesouroJSONNumber(root ? root.bounds.size.height : 0),
    @"truncated" : @(!complete),
  };

  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  if (!data) return @"{\"nodes\":[],\"width\":0,\"height\":0,\"truncated\":false}";
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

// Append `view` and its visible descendants to `nodes`, depth-first in **draw
// order** (first subview first) so the flat array reads top-to-bottom the way the
// tree does. Note this is the reverse of the picker's iteration, which walks
// subviews backwards because the last-drawn one wins a hit; here nothing is
// competing, so document order is the useful order.
//
// `origin` tracks `view`'s position in the root's coordinate space — with
// `bounds.origin` (the parent's scroll offset) subtracted — so every reported
// frame is absolute and the wireframe can draw straight from it.
//
// Returns NO once the node cap is hit, which unwinds the whole walk.
+ (BOOL)collect:(UIView *)view
          depth:(NSInteger)depth
         origin:(CGPoint)origin
         parent:(NSInteger)parent
           into:(NSMutableArray<NSDictionary *> *)nodes {
  if (nodes.count >= BesouroMaxSnapshotNodes) return NO;
  // Where this node lands, captured before appending so children can point back
  // at it. An index rather than a React tag: most views report tag 0 — every
  // `RCTParagraphTextView`, `RCTEnhancedScrollView`, the scroll content view —
  // so a tag would be ambiguous exactly where the tree is hardest to read.
  NSInteger index = (NSInteger)nodes.count;
  [nodes addObject:[self describe:view depth:depth origin:origin parent:parent]];

  for (UIView *subview in view.subviews) {
    if (subview.hidden || subview.alpha < 0.01) continue;
    CGPoint subviewOrigin =
        CGPointMake(origin.x + subview.frame.origin.x - view.bounds.origin.x,
                    origin.y + subview.frame.origin.y - view.bounds.origin.y);
    if (![self collect:subview
                  depth:depth + 1
                 origin:subviewOrigin
                 parent:index
                   into:nodes]) {
      return NO;
    }
  }
  return YES;
}

// The React tag for `view`, or 0 when React doesn't own it. Copied from
// `BesouroElementPicker` — see the note at the top of this file.
+ (NSInteger)reactTagForView:(UIView *)view {
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

// The view whose string this node reports: itself, or — when it is the content
// view another view draws through — that other view. nil when the node shows no
// text at all.
//
// One place decides this so the reported text and the reported style can never
// disagree about which view they came from.
//
// A view that hands its drawing to a content view reports nothing itself; the
// content view reports the string instead, so it lands on the view that actually
// paints it. RN's paragraph is exactly this shape. `RCTParagraphComponentView` is
// the only one of the pair that can be *asked* for the text — its `attributedText`
// reaches into `_textView.state` — but the drawing happens in the auxiliary
// `RCTParagraphTextView` it installs as `self.contentView`, which owns the state,
// implements `-drawRect:`, and exposes no text accessor of its own because it is
// declared privately inside the .mm. Reporting the string on the component view
// put the label on the wrong plane: the one immediately behind the one you can
// see the text on.
+ (UIView *)textSourceOf:(UIView *)view {
  // Hands its text down to its content view; that view reports instead.
  if ([self textPainterOf:view] != nil) return nil;
  if ([self ownTextOf:view].length > 0) return view;
  UIView *superview = view.superview;
  if (superview != nil && [self textPainterOf:superview] == view) return superview;
  return nil;
}

// How the text is drawn — size in points and horizontal alignment — so the
// wireframe can set a label the way the app set it, instead of rendering every
// string at one flat size.
//
// Colour is deliberately not reported. A label in the stack is read against the
// accent fills and the stage behind them, not against whatever surface it sits on
// in the app, so reproducing the app's colour makes it harder to read rather than
// more faithful — dark text on a dark stage.
//
// Read from the attributed string's own attributes first, which is where a
// paragraph keeps them, then from the UILabel-shaped properties for plain UIKit
// text. Anything unavailable is left at its zero value and the drawing falls back
// to its own defaults.
+ (NSDictionary *)textStyleOf:(UIView *)source {
  UIFont *font = nil;
  NSNumber *alignment = nil;

  id<BesouroTextBearing> bearer = (id<BesouroTextBearing>)source;
  if ([source respondsToSelector:@selector(attributedText)]) {
    NSAttributedString *attributed = bearer.attributedText;
    if ([attributed isKindOfClass:NSAttributedString.class] && attributed.length > 0) {
      NSDictionary *attributes = [attributed attributesAtIndex:0 effectiveRange:NULL];
      font = attributes[NSFontAttributeName];
      NSParagraphStyle *paragraph = attributes[NSParagraphStyleAttributeName];
      if ([paragraph isKindOfClass:NSParagraphStyle.class]) {
        alignment = @(paragraph.alignment);
      }
    }
  }
  if (font == nil && [source respondsToSelector:@selector(font)]) {
    font = bearer.font;
  }
  if (alignment == nil && [source respondsToSelector:@selector(textAlignment)]) {
    alignment = @(bearer.textAlignment);
  }

  NSMutableDictionary *style = [NSMutableDictionary dictionary];
  if (font != nil) style[@"textSize"] = BesouroJSONNumber(font.pointSize);
  NSString *name = [self alignmentName:alignment];
  if (name.length > 0) style[@"textAlign"] = name;
  return style;
}

// `left` / `center` / `right`. Natural and justified both report as `left`, which
// is what they render as in a left-to-right layout and close enough for a
// wireframe in a right-to-left one.
+ (NSString *)alignmentName:(NSNumber *)alignment {
  if (alignment == nil) return @"";
  switch ((NSTextAlignment)alignment.integerValue) {
    case NSTextAlignmentCenter:
      return @"center";
    case NSTextAlignmentRight:
      return @"right";
    default:
      return @"left";
  }
}

// The subview `view` delegates its drawing to, or nil when it draws itself or has
// no text to hand down. Duck-typed on `contentView`, the same way the text
// accessors are — a plain ObjC idiom, not a React Native internal.
+ (UIView *)textPainterOf:(UIView *)view {
  if (![view respondsToSelector:@selector(contentView)]) return nil;
  if ([self ownTextOf:view].length == 0) return nil;
  UIView *content = [(id<BesouroTextBearing>)view contentView];
  if (![content isKindOfClass:UIView.class] || content.superview != view) return nil;
  return content;
}

// What `view` says about itself, ignoring any content-view arrangement.
//
// Stock UIKit throughout, like every other field here — no RN header, no linkage,
// alive in a release build. `attributedText`/`text` are declared by UILabel,
// UITextField and UITextView, so the duck-typed reads are ordinary UIKit.
//
// The third source is gated on UIAccessibilityTraitStaticText, the platform's own
// answer to "does this view display text": both RN text views set it
// (`RCTTextView` in its initialiser, `RCTParagraphComponentView` from its
// `accessibilityTraits` override), and so does any UIKit label. That gate matters
// rather than merely tidying — an accessibility label on a button or an image is a
// *description* of the view, not something the view displays, and those carry
// different traits, so reading one here would be a quiet lie.
+ (NSString *)ownTextOf:(UIView *)view {
  id<BesouroTextBearing> bearer = (id<BesouroTextBearing>)view;
  if ([view respondsToSelector:@selector(attributedText)]) {
    NSAttributedString *attributed = bearer.attributedText;
    if ([attributed isKindOfClass:NSAttributedString.class] && attributed.string.length > 0) {
      return [self truncate:attributed.string];
    }
  }
  if ([view respondsToSelector:@selector(text)]) {
    NSString *text = bearer.text;
    if ([text isKindOfClass:NSString.class] && text.length > 0) {
      return [self truncate:text];
    }
  }
  if ((view.accessibilityTraits & UIAccessibilityTraitStaticText) != 0 &&
      view.accessibilityLabel.length > 0) {
    return [self truncate:view.accessibilityLabel];
  }
  return @"";
}

+ (NSString *)truncate:(NSString *)text {
  if (text.length <= BesouroMaxSnapshotText) return text;
  // Cut on a character boundary, not a UTF-16 one. `length` counts code units, so
  // a label whose 120th unit lands inside an emoji or a combining sequence would
  // otherwise come back with half a character — a lone surrogate that then has to
  // survive JSON serialisation and `JSON.parse` on the other side.
  NSRange split =
      [text rangeOfComposedCharacterSequenceAtIndex:BesouroMaxSnapshotText];
  return [text substringToIndex:split.location];
}

// One node. Same fields as the picker's `describeView:origin:`, plus `depth` and
// `text`.
+ (NSDictionary *)describe:(UIView *)view
                     depth:(NSInteger)depth
                    origin:(CGPoint)origin
                    parent:(NSInteger)parent {
  // Only what the view actually has.
  //
  // Every node used to carry `text`, `testID`, `textSize`, `textAlign` and
  // `radius` whether or not it had any — and the vast majority have none, so most
  // of the payload was empty strings and zeroes. Omitting them costs nothing to
  // read (JS fills the defaults back in on parse) and makes a capture legible
  // when it is copied out, which is the only time anyone looks at it.
  NSMutableDictionary *node = [@{
    @"tag" : @([self reactTagForView:view]),
    @"className" : NSStringFromClass(view.class),
    @"depth" : @(depth),
    @"parent" : @(parent),
    @"left" : BesouroJSONNumber(origin.x),
    @"top" : BesouroJSONNumber(origin.y),
    @"width" : BesouroJSONNumber(view.bounds.size.width),
    @"height" : BesouroJSONNumber(view.bounds.size.height),
  } mutableCopy];

  NSString *testID = view.accessibilityIdentifier;
  if (testID.length > 0) node[@"testID"] = testID;

  CGFloat radius = view.layer.cornerRadius;
  if (radius > 0) node[@"radius"] = BesouroJSONNumber(radius);

  UIView *textSource = [self textSourceOf:view];
  if (textSource == nil) return node;

  NSString *text = [self ownTextOf:textSource];
  if (text.length == 0) return node;
  node[@"text"] = text;
  [node addEntriesFromDictionary:[self textStyleOf:textSource]];
  return node;
}

@end
