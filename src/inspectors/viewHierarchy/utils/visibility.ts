/**
 * Whether a captured view is anywhere on the screen it was captured from.
 *
 * A capture is not the screen: a ScrollView reports absolute frames for its whole
 * scrollable extent, so a row scrolled above the fold comes back at `top: -489`
 * on an 874dp screen. Both halves of the tab draw those — the stack no longer
 * clips its sheets, and the list never did — so this is no longer the question of
 * whether a view is *present*. It is the question of how far it is from the part
 * the user can actually see, and both halves answer it the same way: dimmed in
 * the list, faded in the picture, with the screen outline on the back sheet
 * marking the boundary they are outside of.
 *
 * Occlusion is a third question again, and still not one worth asking: a view
 * behind another is in the picture, and the camera can be moved to see it.
 */

import type { HierarchyNode, ViewTreeSnapshot } from '../types';

/**
 * Whether `node` overlaps the captured screen at all.
 *
 * Any overlap counts: a row half-scrolled off the top is being looked at as much
 * as one in the middle, and fading it would be wrong. Zero-area views are
 * excluded for the same reason they are not drawn — there is no box to see.
 */
export function isOnScreen(
  node: HierarchyNode,
  snapshot: ViewTreeSnapshot
): boolean {
  if (node.width <= 0 || node.height <= 0) return false;
  return (
    node.left < snapshot.width &&
    node.top < snapshot.height &&
    node.left + node.width > 0 &&
    node.top + node.height > 0
  );
}
