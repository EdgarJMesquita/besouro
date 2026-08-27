#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

// ─── View tree snapshot ─────────────────────────────────────────────────────
// The whole native view tree under the app's root view, for the View Hierarchy
// tab (SPEC §6.12).
//
// This is `BesouroElementPicker`'s `collectHitPath:` with the point test removed:
// the same descent, the same origin bookkeeping, the same skip rules — it just
// visits every subview instead of the first one under the finger. That is what
// makes the tab cheap and what keeps it working in a release build: the walk is
// built purely from public UIKit geometry, never React Native's internals.
//
// Emitted flat, each node carrying its `depth`, and rebuilt into a tree in JS —
// codegen cannot express a recursive struct, and a flat array is what a
// virtualized list wants anyway.
//
// Main thread only; the module does the hopping.

@interface BesouroViewTreeSnapshot : NSObject

/// The snapshot as a JSON string:
/// `{"width":W,"height":H,"truncated":false,"nodes":[Node]}`, where a Node is
/// `{tag,className,depth,parent,left,top,width,height}` plus — only when the view
/// has them — `testID`, `text`, `textSize`, `textAlign` and `radius`.
///
/// A string rather than a codegen struct array on purpose: it is the escape hatch
/// we would reach for anyway if node counts turn out high, it costs nothing to
/// parse at these sizes, and it makes the payload directly measurable — `.length`
/// in JS is the byte count this feature would put on the bridge.
+ (NSString *)captureJSON;

@end

NS_ASSUME_NONNULL_END
