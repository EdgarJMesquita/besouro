/**
 * Capturing the native view tree.
 *
 * Thin on purpose: the whole mechanism is one TurboModule call plus a
 * `JSON.parse`. That thinness *is* the finding — the walk already exists natively
 * (it's the element pick's, minus the point test), so the JS half of a Hierarchy
 * tab has no traversal, no fiber work, and no renderer dependency in it at all.
 */

import NativeBesouro from '../../native/NativeBesouro';
import { withoutDevTooling } from './utils/dev-tooling';
import type { HierarchyNode, ViewTreeSnapshot } from './types';

/** Whether a capture can be attempted — i.e. the native module is linked. */
export function isHierarchyAvailable(): boolean {
  return NativeBesouro != null;
}

/**
 * Snapshot the native view tree, or null when there is nothing to snapshot (no
 * native module) or the payload didn't parse.
 *
 * Never throws: a devtool that crashes the drawer while inspecting is worse than
 * one that shows nothing. The parse is guarded rather than trusted because the
 * payload crosses a version boundary — a JS bundle can meet an older native build
 * that has no `snapshotViewTree` at all.
 */
export async function captureViewTree(): Promise<ViewTreeSnapshot | null> {
  const native = NativeBesouro;
  if (native == null) return null;
  try {
    return parseSnapshot(await native.snapshotViewTree());
  } catch {
    return null;
  }
}

/** Validate just enough to know the payload is the shape we asked for. */
function parseSnapshot(json: string): ViewTreeSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object') return null;
  const value = parsed as Partial<ViewTreeSnapshot>;
  if (!Array.isArray(value.nodes)) return null;
  return {
    width: numberOr(value.width, 0),
    height: numberOr(value.height, 0),
    truncated: value.truncated === true,
    // React Native's own debugging overlay is dropped here rather than natively,
    // so the captured payload stays a faithful report of the tree and only what
    // the tab draws is filtered — `Copy JSON` still shows everything.
    nodes: withoutDevTooling(value.nodes.map(normalize)),
  };
}

/**
 * Fill in whatever the payload left out.
 *
 * Two different absences, both handled here so nothing downstream has to care:
 *
 * **Sparse by design.** Most views have no text, no `testID` and square corners,
 * so the capture omits those keys rather than sending an empty string or a zero on
 * every node — which was the bulk of the payload, and made it unreadable when
 * copied out. Restoring the defaults keeps `HierarchyNode` a complete record.
 *
 * **Sparse by age.** `parent` is newer than the rest, so a JS bundle can meet a
 * native build without it. Reconstructed from `depth` and document order, which is
 * exactly what every consumer assumed before the field existed — a node's parent
 * is the nearest preceding node one level shallower. That invents nothing new; it
 * makes an existing assumption explicit, and lets plane assignment run one
 * algorithm instead of two.
 */
function normalize(
  node: HierarchyNode,
  index: number,
  nodes: HierarchyNode[]
): HierarchyNode {
  return {
    ...node,
    testID: node.testID ?? '',
    text: node.text ?? '',
    textSize: node.textSize ?? 0,
    textAlign: node.textAlign ?? '',
    radius: node.radius ?? 0,
    fragment: node.fragment ?? '',
    parent:
      typeof node.parent === 'number' ? node.parent : parentOf(index, nodes),
  };
}

/** The nearest preceding node one level shallower, or -1 at the root. */
function parentOf(index: number, nodes: HierarchyNode[]): number {
  const depth = nodes[index]!.depth;
  for (let j = index - 1; j >= 0; j--) {
    if (nodes[j]!.depth === depth - 1) return j;
  }
  return -1;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
