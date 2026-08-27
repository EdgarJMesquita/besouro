/**
 * Focusing: narrowing both halves of the tab to one view and its descendants.
 *
 * Xcode's "Focus on selected view". A capture of a real screen is a hundred-odd
 * views deep in places, and most of what the stack draws is chrome around the
 * thing being looked at — the root, the content view, the ScrollView run, the
 * navigator's frame. Focus throws all of it away and re-draws the subtree as if
 * it were the whole capture, which is the difference between finding a 30dp row
 * inside a 400dp plane and just looking at it.
 *
 * ## Why a range and not a filter
 *
 * A subtree is a *contiguous slice* of the capture, not a scattered subset. Both
 * native walks emit depth-first in draw order, so a node's descendants are
 * exactly the nodes after it up to the next one at its own depth or shallower.
 *
 * That matters beyond tidiness: every index in this tab — selection, plane
 * assignment, the tree list's rows — points into `snapshot.nodes`. A range keeps
 * those indices meaning what they meant, so focusing changes what is *shown* and
 * nothing about what anything *is*. Filtering into a new array would renumber
 * everything and put the two halves on different index spaces, which is the bug
 * this whole tab keeps being careful not to write.
 *
 * The `parent` field could answer the same question by walking ancestry per node.
 * Depth and document order answer it in one pass with no lookups, and both
 * platforms guarantee the order — see `ViewTreeSnapshot.nodes`.
 */

import type { HierarchyNode, ViewTreeSnapshot } from '../types';

/** A rectangle in the capture's dp — what the scene is drawn relative to. */
export type Frame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Half-open `[start, end)` into `snapshot.nodes`. */
export type Range = { start: number; end: number };

/**
 * The node at `index` and every descendant, as a range.
 *
 * Returns the whole capture for a null index, so callers can treat "not focused"
 * as a range too rather than branching on it everywhere.
 */
export function subtreeRange(
  nodes: HierarchyNode[],
  index: number | null
): Range {
  if (index == null || index < 0 || index >= nodes.length) {
    return { start: 0, end: nodes.length };
  }
  const depth = nodes[index]!.depth;
  let end = index + 1;
  // Descendants are deeper by definition; the first node that is not ends it.
  while (end < nodes.length && nodes[end]!.depth > depth) end++;
  return { start: index, end };
}

/**
 * The rectangle the scene is drawn relative to: the focused view's frame, or the
 * whole screen when nothing is focused.
 *
 * Focus is not a filter over the same picture — it re-frames it. The stack's
 * sheets are sized to this, boxes are positioned inside it, and `fit` scales it
 * to the stage. Without that, focusing a 30dp row would draw a 30dp row in the
 * corner of a screen-sized sheet, which is the view you already had.
 */
export function frameOf(
  snapshot: ViewTreeSnapshot,
  index: number | null
): Frame {
  const node = index == null ? undefined : snapshot.nodes[index];
  if (!node || node.width <= 0 || node.height <= 0) {
    return { left: 0, top: 0, width: snapshot.width, height: snapshot.height };
  }
  return {
    left: node.left,
    top: node.top,
    width: node.width,
    height: node.height,
  };
}

/**
 * Slack, in dp, on the full-bleed test.
 *
 * A full-bleed view is not always flush: rounding through a density conversion
 * leaves fractional edges, and a container inset by a hairline is still the whole
 * rectangle as far as anyone reading the picture is concerned.
 */
const FULL_SCREEN_SLACK = 1;

/**
 * Whether a view covers the whole frame the scene is drawn in.
 *
 * Unfocused that frame is the screen, and this picks out the full-bleed chain —
 * root, content view, the ScrollView run — which is exactly the set of boxes a
 * name helps most: they are all the same rectangle, so the picture cannot tell
 * them apart, and only the sheet they sit on and the name on it can. Focused, it
 * picks out the same thing one level down, since a focused subtree usually opens
 * with its own run of same-sized wrappers.
 *
 * Every other box is distinguished by its shape and position, which is what the
 * wireframe is already showing.
 */
export function coversFrame(node: HierarchyNode, origin: Frame): boolean {
  return (
    node.left <= origin.left + FULL_SCREEN_SLACK &&
    node.top <= origin.top + FULL_SCREEN_SLACK &&
    node.left + node.width >= origin.left + origin.width - FULL_SCREEN_SLACK &&
    node.top + node.height >= origin.top + origin.height - FULL_SCREEN_SLACK
  );
}
