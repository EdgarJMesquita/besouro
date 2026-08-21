/**
 * Element pick mechanism — internal.
 *
 * Tap-to-highlight over the app, resolving the element at a touch point by one of
 * three paths, in order of how much they can tell us:
 *
 * 1. The renderer's `getInspectorDataForViewAtPoint` (the same call RN's built-in
 *    inspector uses), read off the React DevTools hook rather than deep-imported
 *    from `react-native`. Component hierarchy, props, box model, and the fiber
 *    that makes live editing possible — but debug builds only, since a release
 *    build links React's prod renderer bundle where those entries throw. See
 *    {@link isFullInspectionAvailable}.
 * 2. The fiber the native hit-test points at ({@link toFiberElement}). Real React
 *    props and a best-effort hierarchy, read-only — a prod bundle ships no
 *    `overrideProps` to write through. Needs a DevTools hook to find a fiber tree
 *    at all, which {@link ./devtools-hook} supplies when nothing else did.
 * 3. The native hit-test on its own ({@link toNativeElement}). Native class names,
 *    real on-screen bounds and `testID`, no props. Public platform APIs only, so
 *    it works even for views React doesn't own.
 *
 * The lower two exist so the tab still does something useful in release, where
 * only the first is unavailable.
 *
 * Unlike the log-style inspectors, this holds **one live element at a time** (see
 * {@link ./store/inspection}) — the currently inspected node, editable in place —
 * not a capture history. {@link ./interceptor} only enables the tab; capture is
 * driven from here by {@link startElementPick} (native overlay), which the Element
 * tab calls. Nothing here is publicly exported.
 */

import { safeCapture } from '../../core/base-interceptor';
import { setActiveInspector } from '../../core/active-inspector-store';
import { setInspectedElement } from './store/inspection';
import type { InspectedElement, ElementFrame, ElementRenderer } from './types';
import { toFiberElement } from './fiber';
import NativeBesouro, { type NativeNode } from '../../native/NativeBesouro';

interface InspectorSource {
  fileName?: string;
  lineNumber?: number;
}

interface InspectorHierarchyItem {
  name?: string;
}

/** Shape returned by `getInspectorDataForViewAtPoint`'s callback. */
interface InspectorViewData {
  hierarchy: InspectorHierarchyItem[];
  props?: Record<string, unknown>;
  selectedIndex?: number;
  source?: InspectorSource;
  frame?: ElementFrame;
  /** Native view tag of the touched view. */
  touchedViewTag?: number;
  /** The resolved element's fiber — used for live prop editing. */
  closestInstance?: unknown;
}

type GetInspectorDataForViewAtPoint = (
  inspectedView: unknown,
  locationX: number,
  locationY: number,
  callback: (viewData: InspectorViewData) => void
) => void;

/**
 * The renderer's element hit-test, or null when this renderer can't perform one.
 *
 * Not a plain presence check: the prod renderer bundle still ships a
 * `rendererConfig` carrying a `getInspectorDataForViewAtPoint`, so testing for the
 * function finds one in release too. See {@link isElementInspectorAvailable} for
 * how we tell the real one from the stub.
 */
function inspectorHitTest(
  renderer: RendererInternals
): GetInspectorDataForViewAtPoint | null {
  const config = renderer.rendererConfig;
  if (!config?.getInspectorDataForViewAtPoint) {
    return null;
  }
  return config.getInspectorDataForInstance
    ? config.getInspectorDataForViewAtPoint
    : null;
}

/**
 * Resolve the element under `(locationX, locationY)` within `inspectedView` (the
 * app's root view handle) and publish it as the current inspected element (along
 * with its fiber, for editing). Replaces any previously inspected element.
 * Returns false when the renderer API is unavailable.
 *
 * The hit-test comes off the renderer itself (`rendererConfig`, via the DevTools
 * hook) rather than RN's `getInspectorDataForViewAtPoint` module — that module is
 * a private deep import whose path moved in RN 0.83, and all it does is call this
 * same renderer method. Reading it from the hook keeps us on one code path across
 * RN versions and out of the deep-import deprecation warning.
 *
 * Like RN's module we try every registered renderer: only the one that owns the
 * view reports a non-empty hierarchy. The renderer that answers is also the one
 * that owns the fiber, so it's the handle we keep for live prop editing.
 */
function resolveElementAtPoint(
  inspectedView: unknown,
  locationX: number,
  locationY: number
): boolean {
  const hook = getHook();
  if (!hook?.renderers) {
    return false;
  }
  let resolved = false;
  for (const renderer of hook.renderers.values()) {
    const getInspectorData = inspectorHitTest(renderer);
    if (!getInspectorData) {
      continue;
    }
    // The renderer invokes this synchronously, so `resolved` is set by the time
    // the call returns (RN's own module relies on the same guarantee to break).
    getInspectorData(inspectedView, locationX, locationY, (viewData) => {
      if (!viewData || viewData.hierarchy.length === 0) {
        return;
      }
      resolved = true;
      safeCapture(() => {
        setInspectedElement(
          toInspectedElement(viewData),
          viewData.closestInstance ?? null,
          renderer
        );
      });
    });
    if (resolved) {
      break;
    }
  }
  return resolved;
}

/**
 * Publish whatever the native hit-test path can be turned into: the fiber it
 * points at if one is reachable, else the native view chain on its own.
 *
 * The touched view's tag is the join between the two worlds — the platform knows
 * it because React assigned it as the view's id/tag, and the fiber tree can be
 * searched for it. When a fiber is found the element is a real React element
 * (component names, props) that simply can't be edited; when it isn't — a view
 * React doesn't own, or no hook to read a tree from — the native chain is still
 * worth showing.
 */
function resolveFromNativePath(path: NativeNode[]): void {
  const nativeElement = toNativeElement(path);
  if (!nativeElement) {
    return;
  }
  const touched = path[path.length - 1] as NativeNode;
  const resolved = toFiberElement(
    touched.tag,
    nativeElement.frame,
    nativeElement.testID
  );
  if (resolved) {
    // Null renderer: `overrideProps` doesn't exist in a prod bundle, so the store
    // must not think editing is on the table. This tier shows, it doesn't edit.
    setInspectedElement(resolved.element, resolved.fiber, null);
    return;
  }
  setInspectedElement(nativeElement, null, null);
}

function toNativeElement(path: NativeNode[]): InspectedElement | null {
  const touched = path[path.length - 1];
  if (!touched) {
    return null;
  }
  return {
    origin: 'native',
    componentName: touched.className,
    hierarchy: path.map((node) => node.className),
    // Nothing on the native side knows about React props.
    props: {},
    frame: {
      left: touched.left,
      top: touched.top,
      width: touched.width,
      height: touched.height,
    },
    testID: touched.testID || undefined,
  };
}

function toInspectedElement(viewData: InspectorViewData): InspectedElement {
  const hierarchy = viewData.hierarchy
    .map((item) => item.name)
    .filter(
      (name): name is string => typeof name === 'string' && name.length > 0
    );
  const selectedName =
    viewData.selectedIndex != null
      ? hierarchy[viewData.selectedIndex]
      : undefined;
  return {
    origin: 'renderer',
    componentName: selectedName ?? hierarchy[hierarchy.length - 1] ?? 'Unknown',
    hierarchy,
    // Kept raw (not stringified) so individual values stay editable.
    props: viewData.props ?? {},
    frame: viewData.frame,
    source: formatSource(viewData.source),
  };
}

function formatSource(source: InspectorSource | undefined): string | undefined {
  if (!source?.fileName) {
    return undefined;
  }
  return source.lineNumber != null
    ? `${source.fileName}:${source.lineNumber}`
    : source.fileName;
}

// ── Tap-to-inspect pick session ─────────────────────────────────────────────
// The drawer is a native-injected surface, so it can't render a JS overlay over
// the app. Capture is driven natively: `startElementInspection` dismisses the
// drawer, overlays a transparent capture layer, and reports the tap point (in the
// app root's coordinate space). Resolving that point still needs a host-component
// root instance to hit-test from — which the native side can't produce — so we
// pull it from the app's own React tree here via the DevTools global hook.

interface Fiber {
  tag: number;
  stateNode: unknown;
  child: Fiber | null;
  sibling: Fiber | null;
}
interface FiberRoot {
  current: Fiber;
  containerInfo?: unknown;
}
/** The renderer object registered on the hook — RN's DevTools `internals`, which
 *  carries `overrideProps` (what we drive to edit props live) and, under
 *  `rendererConfig`, React Native's element hit-test. */
interface RendererInternals extends ElementRenderer {
  version?: string;
  rendererConfig?: {
    getInspectorDataForViewAtPoint?: GetInspectorDataForViewAtPoint;
    /** Only read as a dev/prod marker — see {@link inspectorHitTest}. */
    getInspectorDataForInstance?: unknown;
  };
}
interface DevToolsHook {
  renderers?: Map<number, RendererInternals>;
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
 * Whether tap-to-inspect can run at all. Only needs our own native module: the
 * pick is native (overlay + hit-test), and its result degrades to
 * {@link toNativeElement} when React's renderer can't answer. So this is true in
 * release builds too — what changes there is how much detail comes back, which
 * {@link isFullInspectionAvailable} reports.
 */
export function isElementInspectorAvailable(): boolean {
  return NativeBesouro != null;
}

/**
 * Whether a pick will come back with React-level detail — component names and
 * live, editable props — rather than just the native view chain. Two things have
 * to hold.
 *
 * The React DevTools hook has to be there — React Native installs it only in
 * dev/debug builds (`setUpReactDevTools` is `__DEV__`-gated) — since we need both
 * its renderer list and `getFiberRoots`.
 *
 * And some registered renderer has to offer a hit-test that actually works. The
 * hook alone doesn't imply that: React injects into whatever hook it finds,
 * including one we installed ourselves, and in a release build what it injects is
 * the prod renderer bundle. That bundle does not *strip* the inspector API — it
 * ships a `rendererConfig` whose entries are stubs that throw "not available in
 * production", so a truthiness check on `getInspectorDataForViewAtPoint` passes and
 * calling it is the only way to find out. We discriminate on the sibling entry the
 * prod bundle leaves `undefined` rather than stubbing —
 * `getInspectorDataForInstance`, present only in the dev bundle — which marks the
 * whole config as the real one. (The renderer's own `bundleType`, 0 in prod and 1
 * in dev, is the same signal one level up.)
 *
 * Live prop editing rides along with this: `overrideProps` is likewise
 * dev-bundle-only, and {@link ./store/inspection} gates on it separately.
 */
export function isFullInspectionAvailable(): boolean {
  const hook = getHook();
  if (!hook?.renderers || !hook.getFiberRoots) {
    return false;
  }
  for (const renderer of hook.renderers.values()) {
    if (inspectorHitTest(renderer)) {
      return true;
    }
  }
  return false;
}

/**
 * Derive a public host instance (the thing `getInspectorDataForViewAtPoint`
 * accepts as `inspectedView`) from a host fiber's `stateNode`. Mirrors RN's own
 * `findHostInstance_DEPRECATED`: Fabric exposes the public instance under
 * `canonical.publicInstance`; Paper's stateNode is itself the public instance
 * (identified by `_nativeTag`). Returns null for anything we don't recognise.
 */
function publicInstanceOf(stateNode: unknown): unknown {
  if (stateNode == null || typeof stateNode !== 'object') {
    return null;
  }
  const node = stateNode as {
    canonical?: { publicInstance?: unknown };
    _nativeTag?: unknown;
  };
  if (node.canonical?.publicInstance != null) {
    return node.canonical.publicInstance;
  }
  if (node._nativeTag != null) {
    return stateNode;
  }
  return null;
}

/** Depth-first, left-to-right search for the first host instance under `root`. */
function firstHostInstance(root: Fiber): unknown {
  const stack: Fiber[] = [root];
  while (stack.length > 0) {
    const fiber = stack.pop() as Fiber;
    if (fiber.tag === HOST_COMPONENT) {
      const instance = publicInstanceOf(fiber.stateNode);
      if (instance != null) {
        return instance;
      }
    }
    // Push sibling first so child is popped (visited) first — leftmost-deepest.
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  return null;
}

/**
 * Resolve the app's root host instance from the React DevTools global hook. When
 * `rootTag` is given we prefer the matching FiberRoot (multi-root apps); otherwise
 * the first root that yields a host instance wins. Returns null when the hook is
 * absent (every release build, unless something else installed one) — capture then
 * no-ops.
 */
export function getRootPublicInstance(rootTag?: number): unknown {
  const hook = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook })
    .__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (!hook?.renderers || !hook.getFiberRoots) {
    return null;
  }
  let fallback: unknown = null;
  for (const rendererId of hook.renderers.keys()) {
    let roots: Set<FiberRoot>;
    try {
      roots = hook.getFiberRoots(rendererId);
    } catch {
      continue;
    }
    for (const root of roots) {
      const instance = firstHostInstance(root.current);
      if (instance == null) {
        continue;
      }
      if (rootTag != null && rootTag > 0 && root.containerInfo === rootTag) {
        return instance;
      }
      fallback ??= instance;
    }
  }
  return fallback;
}

/**
 * Start a tap-to-inspect session. Asks the native module to dismiss the drawer and
 * overlay a capture layer; on the resulting tap, resolves the element at the point
 * against the app's root instance, publishes it as the current inspected element,
 * then reopens the drawer focused on the Element tab. One-shot by nature (a single
 * native tap callback). No-ops when the native module isn't linked. Returns false
 * when it can't start.
 */
export function startElementPick(): boolean {
  // Capture as a non-null const so the narrowing survives into the deferred
  // capture callback below (module-level narrowing wouldn't reach it).
  const native = NativeBesouro;
  if (!native) {
    return false;
  }
  native.startElementInspection((x, y, rootTag, path) => {
    safeCapture(() => {
      // Three paths, richest first. The renderer's own hit-test wherever it works
      // (debug builds); otherwise the fiber the native hit-test pointed us at,
      // which still carries component names and props; otherwise the native view
      // chain alone. Each falls through only when the one above it comes up empty.
      const root = getRootPublicInstance(rootTag);
      if (root == null || !resolveElementAtPoint(root, x, y)) {
        resolveFromNativePath(path ?? []);
      }
      native.openDrawer();
      setActiveInspector('element');
    });
  });
  return true;
}
