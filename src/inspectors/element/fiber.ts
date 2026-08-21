/**
 * Native tag → fiber resolution — internal.
 *
 * The release-build counterpart to the renderer's own hit-test. A release build
 * links React's prod renderer bundle, whose inspector entries throw (see
 * `./picker`), but the fiber tree itself is perfectly ordinary data: `memoizedProps`,
 * `return`, `child`, `stateNode` are plain fields React has carried since 16, and
 * they're exactly what React DevTools reads. What a release build lacks is a hook
 * for renderers to register with — which `./devtools-hook` supplies.
 *
 * So: the native pick reports the touched view's React tag, and this module finds
 * the host fiber that owns that tag and reads the element off it.
 *
 * What is **not** here, deliberately: any write path. Editing goes through the
 * renderer's `overrideProps`, which the prod bundle doesn't ship at all, so there
 * is nothing to drive. This tier reads.
 */

import type { InspectedElement, ElementFrame } from './types';

/** The fiber fields we read. All long-standing, all present in prod builds. */
interface Fiber {
  tag: number;
  type: unknown;
  elementType: unknown;
  stateNode: unknown;
  memoizedProps: Record<string, unknown> | null;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
}

interface FiberRoot {
  current: Fiber;
}

interface DevToolsHook {
  renderers?: Map<number, unknown>;
  getFiberRoots?: (rendererId: number) => Set<FiberRoot>;
}

/** React's HostComponent fiber tag (`<View>`, `<Text>`, …). */
const HOST_COMPONENT = 5;

function getHook(): DevToolsHook | null {
  return (
    (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__ ?? null
  );
}

/**
 * The native tag a host fiber's `stateNode` refers to, or null.
 *
 * Covers both renderers. Fabric's `stateNode` is `{node, canonical}` and the tag
 * lives at `canonical.nativeTag`, assigned when the instance is created
 * (`ReactFabric-prod.js:7112`). Paper's `stateNode` is the public instance itself,
 * identified by `_nativeTag`.
 *
 * Read straight off `canonical`, deliberately, and **not** through
 * `canonical.publicInstance.__nativeTag`: that public instance is created lazily
 * and sits at `null` until something asks for it (`ReactFabric-prod.js:10360`).
 * Nothing in a release build ever asks, so going that way found a null on every
 * host fiber and no element ever resolved.
 */
function nativeTagOf(stateNode: unknown): number | null {
  if (stateNode == null || typeof stateNode !== 'object') {
    return null;
  }
  const node = stateNode as {
    canonical?: { nativeTag?: unknown };
    _nativeTag?: unknown;
  };
  const fabric = node.canonical?.nativeTag;
  if (typeof fabric === 'number') {
    return fabric;
  }
  return typeof node._nativeTag === 'number' ? node._nativeTag : null;
}

/**
 * A readable name for a fiber's component.
 *
 * Host components carry their type as a string (`'RCTView'`), so those stay
 * readable in any build. Composites resolve through `displayName`/`name`, which
 * Metro's minifier mangles in release unless the app opts into `keep_fnames` —
 * so expect `oe` rather than `ProfileScreen` there. Returns null for fibers with
 * no useful name (fragments, context providers) so callers can skip them.
 */
function fiberName(fiber: Fiber): string | null {
  const type = fiber.type ?? fiber.elementType;
  if (typeof type === 'string') {
    return type;
  }
  if (
    typeof type === 'function' ||
    (typeof type === 'object' && type != null)
  ) {
    const named = type as { displayName?: unknown; name?: unknown };
    if (typeof named.displayName === 'string' && named.displayName) {
      return named.displayName;
    }
    if (typeof named.name === 'string' && named.name) {
      return named.name;
    }
  }
  return null;
}

/**
 * Depth-first search for the host fiber whose native tag is `tag`.
 *
 * Iterative rather than recursive: a deep tree would otherwise risk blowing the
 * stack on a device, and this runs on a user's tap.
 */
function findHostFiberByTag(root: Fiber, tag: number): Fiber | null {
  const stack: Fiber[] = [root];
  while (stack.length > 0) {
    const fiber = stack.pop() as Fiber;
    if (fiber.tag === HOST_COMPONENT && nativeTagOf(fiber.stateNode) === tag) {
      return fiber;
    }
    // Push sibling first so child is visited first — matches document order.
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  return null;
}

/** The host fiber owning `tag`, searched across every registered renderer. */
export function fiberForNativeTag(tag: number): Fiber | null {
  const hook = getHook();
  if (!hook?.renderers || !hook.getFiberRoots || tag <= 0) {
    return null;
  }
  for (const rendererId of hook.renderers.keys()) {
    let roots: Set<FiberRoot>;
    try {
      roots = hook.getFiberRoots(rendererId);
    } catch {
      continue;
    }
    for (const root of roots) {
      const found = findHostFiberByTag(root.current, tag);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

/**
 * Build an inspected element from the fiber owning `tag`, or null when no fiber
 * matches (a view React doesn't own, or no hook at all).
 *
 * `frame` is passed in from the native hit-test rather than measured here: the
 * platform already reported the view's real on-screen bounds during the pick, and
 * measuring again from JS would be both slower and less accurate.
 *
 * The hierarchy walks `fiber.return` to the root and reverses, so it reads
 * outermost-first like the renderer path's does. Unnamed fibers are skipped rather
 * than rendered as blanks.
 */
export function toFiberElement(
  tag: number,
  frame: ElementFrame | undefined,
  testID: string | undefined
): { element: InspectedElement; fiber: unknown } | null {
  const fiber = fiberForNativeTag(tag);
  if (!fiber) {
    return null;
  }
  const hierarchy: string[] = [];
  for (let node: Fiber | null = fiber; node != null; node = node.return) {
    const name = fiberName(node);
    if (name != null) {
      hierarchy.push(name);
    }
  }
  hierarchy.reverse();
  return {
    element: {
      origin: 'fiber',
      componentName: hierarchy[hierarchy.length - 1] ?? 'Unknown',
      hierarchy,
      // Kept raw, like the renderer path, so the same viewer renders both.
      props: fiber.memoizedProps ?? {},
      frame,
      testID,
    },
    fiber,
  };
}
