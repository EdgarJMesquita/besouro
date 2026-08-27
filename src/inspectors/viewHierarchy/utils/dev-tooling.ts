/**
 * Dropping development tooling from a capture — React Native's debugging overlay,
 * and whole branches that React does not own.
 *
 * `RCTDebuggingOverlay` (iOS) / `DebuggingOverlay` (Android) is the surface RN
 * paints element highlights and trace rectangles on. It is mounted under the app's
 * root component view, it is full-screen, and it descends in lockstep with the
 * app's real branch — so a capture shows two identical rectangles at every depth
 * from 4 to 6, one of them belonging to a tool rather than to the app. It is
 * exactly the noise Besouro's own bubble and drawer already avoid by living
 * outside the React root; the overlay just happens to live inside it.
 *
 * ## The class-name match, and why it is here rather than in the walk
 *
 * This is the one place in the hierarchy feature that matches on a React Native
 * class name — the thing the native side deliberately refuses to do (see
 * `textForView:` in `BesouroViewTreeSnapshot.mm`, which was rewritten to gate on
 * `UIAccessibilityTraitStaticText` instead of on names containing "Text"). The
 * distinction that makes it acceptable: reading a name to *invent* data is a lie,
 * whereas reading one to *exclude* known tooling is a presentation choice, and a
 * visible one — the raw payload still contains the overlay, so `Copy JSON` shows
 * it and nothing is hidden from anyone looking.
 *
 * Keeping it in JS rather than in the native walk is the same reasoning: the
 * capture stays a faithful report of the view tree, and only what the tab draws
 * is filtered.
 */

import type { HierarchyNode } from '../types';

/**
 * `nodes` without React Native's debugging overlay, without any branch React does
 * not own, and without any container those leave holding nothing else.
 *
 * That second pass is what makes it work. The overlay sits under a plain
 * `RCTViewComponentView` whose only purpose is to host it — an ordinary class
 * name, indistinguishable from an app view by name alone. Structure identifies
 * it instead: a container whose every child was dropped, and which shows nothing
 * itself, is a wrapper around nothing.
 *
 * O(n²) in the worst case, over a list of a few hundred. Measured captures run
 * ~120 nodes, so this is not worth an index.
 */
export function withoutDevTooling(nodes: HierarchyNode[]): HierarchyNode[] {
  const dropped = nodes.map(() => false);

  // Pass 1 — development tooling, and everything under it.
  //
  // A list of names, and nothing else. This tab inspects the app's *platform*
  // view hierarchy, so the default is that every view shows up; the only reason
  // anything is hidden is that a tool drew it over the app being inspected, and
  // the honest way to say that is to name the tool.
  //
  // Two earlier versions inferred it instead — "this branch has no React tag
  // anywhere in it", then "this branch has no React surface in it" — and both
  // were wrong in the same way. They asked where React is in order to decide what
  // the app is, which quietly makes React the definition of the app, when the
  // subject here is the platform tree underneath it. They also both failed on
  // their own terms: the tag is `View.id` on Android and means nothing about
  // React, and reasoning from the surface erased anything the walk did not find
  // one in.
  //
  // Descendants are the run of following nodes deeper than the match, since the
  // array is document order.
  nodes.forEach((node, index) => {
    if (!isDevTooling(node)) return;
    for (let j = index; j < subtreeEnd(nodes, index); j++) dropped[j] = true;
  });

  // Pass 2 — wrappers left empty. Backwards, so a node's children are already
  // decided by the time it is considered, and the collapse can cascade upward
  // through a whole chain of hosts.
  for (let index = nodes.length - 1; index >= 0; index--) {
    if (dropped[index]) continue;
    const node = nodes[index]!;
    // A view that shows something of its own is never just a wrapper.
    if (node.text !== '' || node.testID !== '') continue;
    let hadChild = false;
    let keptChild = false;
    for (let j = index + 1; j < nodes.length; j++) {
      if (nodes[j]!.depth <= node.depth) break;
      if (nodes[j]!.depth !== node.depth + 1) continue;
      hadChild = true;
      if (!dropped[j]) {
        keptChild = true;
        break;
      }
    }
    if (hadChild && !keptChild) dropped[index] = true;
  }

  return renumber(nodes, dropped);
}

/**
 * Drop the marked nodes and repoint `parent` at the survivors.
 *
 * The repointing is the whole reason this is a function. `parent` is an index
 * into the array it arrived in, so filtering renumbers every node after the
 * first gap and leaves every `parent` pointing at whatever now occupies the old
 * slot. Nothing downstream notices: `assignPlanes` guards with `parent < index`,
 * so a stale pointer either reads *a different node's* plane or falls through to
 * `node.depth` — the fallback for payloads too old to carry `parent` at all. Both
 * are silent, and the second quietly gives up the one thing `parent` was captured
 * for, which is placing views React Native has flattened.
 *
 * A kept node's parent is always kept — dropping a branch drops it whole, and
 * pass 2 only drops a wrapper once every child of it is gone — but the walk
 * upward costs nothing and means a future pass cannot reintroduce the bug.
 */
function renumber(nodes: HierarchyNode[], dropped: boolean[]): HierarchyNode[] {
  const moved: number[] = new Array(nodes.length).fill(-1);
  let next = 0;
  for (let index = 0; index < nodes.length; index++) {
    if (!dropped[index]) moved[index] = next++;
  }
  const kept: HierarchyNode[] = [];
  for (let index = 0; index < nodes.length; index++) {
    if (dropped[index]) continue;
    let parent = nodes[index]!.parent;
    while (parent >= 0 && dropped[parent]) parent = nodes[parent]!.parent;
    kept.push({ ...nodes[index]!, parent: parent < 0 ? -1 : moved[parent]! });
  }
  return kept;
}

/**
 * Whether a view belongs to development tooling drawn over the app.
 *
 * Two tools, each identified by something it actually is:
 *
 * - **React Native's debugging overlay**, by class name, in all its spellings:
 *   `RCTDebuggingOverlayComponentView`, `RCTDebuggingOverlay`, and Android's
 *   `DebuggingOverlay`.
 * - **Expo's dev-menu bubble**, by the tag its fragment was added under. Its
 *   views are a bare `LinearLayout` holding a bare `ComposeView`
 *   (`DevMenuFragment.onCreateView`), so no class name — simple or qualified —
 *   tells it apart from Compose the app renders itself. The fragment tag does,
 *   exactly, and the capture carries it because the platform knows it and a view
 *   tree cannot show it.
 *
 * Two earlier rules inferred it instead. "No React tag in this branch" and "no
 * React surface in this branch" both made React the definition of the app, when
 * the subject here is the platform tree underneath it. A third matched the
 * bubble's stacking order — `z = Float.MAX_VALUE`, which the fragment does set —
 * and that one at least asked about the platform, but it is a fingerprint rather
 * than an identity: a library lifting a toast or a sheet above the rest would
 * have been caught by it, and a toast the app shows is the app's UI.
 */ function isDevTooling(node: HierarchyNode): boolean {
  return (
    node.className.includes('DebuggingOverlay') ||
    TOOL_FRAGMENTS.has(node.fragment)
  );
}

/**
 * Fragment tags whose views belong to development tooling rather than the app.
 *
 * Exact matches, because a tag is a name a tool chose for itself and not a
 * pattern to be guessed at. `ExpoDevMenuFragment` is `DevMenuFragment.TAG`, the
 * same string `DevMenuFragment.findIn` looks the fragment up by.
 */
const TOOL_FRAGMENTS = new Set(['ExpoDevMenuFragment']);

/**
 * Index one past the last node of the subtree rooted at `index`.
 *
 * The array is document order, so a subtree is the node plus the run of
 * following nodes deeper than it — no parent pointers needed.
 */
function subtreeEnd(nodes: HierarchyNode[], index: number): number {
  const depth = nodes[index]!.depth;
  let end = index + 1;
  while (end < nodes.length && nodes[end]!.depth > depth) end++;
  return end;
}
