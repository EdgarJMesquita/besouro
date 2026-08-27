/**
 * Which plane each captured view is drawn on in the exploded stack.
 *
 * Two rules, and the second only became possible once the capture started
 * reporting `parent`:
 *
 * 1. **A view is always exactly one plane in front of its parent.** Not "one
 *    deeper than its depth" — derived from where the parent actually landed. So a
 *    view can never share a sheet with its own parent, whatever happened further
 *    up the tree.
 * 2. **A view landing inside a rectangle already taken on its plane is pushed
 *    forward** until it finds clear space. Tree structure alone does not prevent
 *    overlap, for two reasons:
 *
 *    - Sibling subtrees that descend in lockstep put *identical* rectangles on
 *      the same sheet, drawn exactly on top of each other.
 *    - React Native flattens hierarchy. `<View><View><Text>` with a background on
 *      each comes back as three *siblings* of the same parent, nested in geometry
 *      and flat in structure — confirmed by `parent`, which reports the same
 *      parent index for all three. Placed by parentage alone they share one
 *      sheet, and a view drawn on top of the one containing it is invisible.
 *
 *    Neither is fixable with spread, because spread moves planes and these are on
 *    the *same* plane. Containment is the test rather than equality: identical
 *    frames are just the case where each contains the other, and it catches the
 *    flattened nesting the tree no longer records.
 *
 * ## What `parent` bought
 *
 * The previous version keyed off `node.depth` and carried a single monotonic
 * offset: pushing one view shifted *every* view after it, including unrelated
 * branches. That was not a bug, it was the price of using depth — a per-subtree
 * nudge would have let a later branch overtake an earlier branch's descendants,
 * because nothing in `depth` ties a child to where its parent ended up.
 *
 * Deriving from the parent's plane removes the trade entirely. A push now moves
 * the colliding view and its descendants — which follow automatically, since each
 * derives from its parent — and nothing else. Unrelated branches keep their
 * planes, so the stack stays as shallow as the screen actually requires.
 *
 * Depth itself is untouched: the tree list still indents by `node.depth`, which is
 * the truth about the hierarchy. This is a drawing decision, and it lives apart
 * from the drawing so it can be tested.
 */

import type { HierarchyNode } from './types';

/**
 * The plane index for each node, parallel to `nodes`.
 *
 * Containment is the test, not overlap. Two views crossing at a corner read fine
 * on one sheet and separating them would spend a plane to fix nothing; a view
 * *inside* another is the case where the outer one is only visible as a border
 * around the inner one, which is what a separate sheet exists to undo.
 */
export function assignPlanes(nodes: HierarchyNode[]): number[] {
  const planes: number[] = [];
  // Frames already taken on each plane. A list rather than a set of keys, since
  // the question is now geometric and not an equality lookup.
  const occupied = new Map<number, HierarchyNode[]>();

  nodes.forEach((node, index) => {
    // A parent is always earlier in the array — the walk emits it before
    // descending — so its plane is known by now. Anything else is a root.
    const parent = node.parent;
    const rooted = parent >= 0 && parent < index;
    let plane = rooted ? planes[parent]! + 1 : node.depth;

    // A `while`, not an `if`: pushing off one collision can land on another, as
    // it does for a chain of flattened views, each inside the last.
    while (occupied.get(plane)?.some((other) => nested(other, node))) {
      plane += 1;
    }

    let taken = occupied.get(plane);
    if (taken === undefined) {
      taken = [];
      occupied.set(plane, taken);
    }
    taken.push(node);
    planes.push(plane);
  });

  return planes;
}

/** The deepest plane in an assignment, or 0 when there is nothing to draw. */
export function lastPlane(planes: number[]): number {
  let max = 0;
  for (const plane of planes) {
    if (plane > max) max = plane;
  }
  return max;
}

/**
 * How many planes deep a slice of the capture draws, counted from its own first
 * plane — the ceiling for the depth control, and the size of the stack.
 *
 * Relative, because a focused subtree starts on whatever plane its root landed
 * on and is redrawn from zero. Zero-area views are skipped for the same reason
 * the stack skips them: they have nothing to draw, and counting them would put a
 * notch on the control that changes nothing.
 */
export function planeDepth(
  nodes: HierarchyNode[],
  planes: number[],
  start: number,
  end: number
): number {
  const base = planes[start] ?? 0;
  let max = 0;
  for (let index = start; index < end; index++) {
    const node = nodes[index];
    if (!node || node.width <= 0 || node.height <= 0) continue;
    const plane = (planes[index] ?? node.depth) - base;
    if (plane > max) max = plane;
  }
  return max;
}

/**
 * Whether one frame sits inside the other, either way round.
 *
 * Symmetric because the order they arrive in says nothing: a flattened chain
 * happens to run outermost-first, but two views with identical frames contain
 * each other and neither is the outer one.
 */
function nested(a: HierarchyNode, b: HierarchyNode): boolean {
  return covers(a, b) || covers(b, a);
}

function covers(outer: HierarchyNode, inner: HierarchyNode): boolean {
  return (
    inner.left >= outer.left - TOLERANCE &&
    inner.top >= outer.top - TOLERANCE &&
    inner.left + inner.width <= outer.left + outer.width + TOLERANCE &&
    inner.top + inner.height <= outer.top + outer.height + TOLERANCE
  );
}

/**
 * Slack on the containment test, in dp. Frames arrive with float noise
 * (`37.666664` against `37.666671`), and a half-dp difference is not a nesting.
 */
const TOLERANCE = 0.5;
