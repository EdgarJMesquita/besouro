/**
 * A minimal React DevTools global hook — internal.
 *
 * React looks for `__REACT_DEVTOOLS_GLOBAL_HOOK__` when its renderer module first
 * evaluates and, if it finds one that isn't disabled and supports fibers, injects
 * itself into it. React Native only ever installs that hook in dev builds
 * (`setUpReactDevTools` is `__DEV__`-gated), which is why a release build has no
 * fiber tree to inspect — not because React withholds one, but because nobody was
 * listening. This module is that listener.
 *
 * It is deliberately the smallest hook React will accept:
 *
 * - `inject` records the renderer so {@link ./picker} can find it.
 * - `onCommitFiberRoot` records fiber roots, and nothing else.
 * - `onCommitFiberUnmount` is **not defined**, on purpose. React calls it once per
 *   deleted fiber (`ReactFabric-prod.js:7903`), so it's the one genuinely hot hook
 *   callback; leaving it undefined means React's `typeof === 'function'` guard
 *   short-circuits instead of entering our code.
 *
 * Everything else real React DevTools does — tree serialization, the bridge,
 * profiling — is absent, which is what keeps this cheap enough to run in a shipped
 * app. React wraps every hook callback in its own `try/catch`, so a fault here
 * can't propagate into the app's commit.
 *
 * Timing matters: this has to be installed before React's renderer module is first
 * required, which happens lazily on the first render
 * (`RendererImplementation.js:28`). Inspector install runs at module scope, well
 * before that, so installing from {@link ./interceptor} is early enough.
 */

/** The subset of a fiber root we touch. */
interface FiberRoot {
  current: {
    memoizedState?: { element?: unknown } | null;
  } | null;
  containerInfo?: unknown;
}

interface DevToolsHookShim {
  isDisabled: boolean;
  supportsFiber: boolean;
  renderers: Map<number, unknown>;
  inject(internals: unknown): number;
  getFiberRoots(rendererId: number): Set<FiberRoot>;
  onCommitFiberRoot(rendererId: number, root: FiberRoot): void;
}

type HookGlobal = {
  __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown;
};

/** Whether the hook on the global is one we installed (vs React DevTools'). */
const OURS = Symbol.for('besouro.hook-shim');

function createHook(): DevToolsHookShim {
  const renderers = new Map<number, unknown>();
  const fiberRoots = new Map<number, Set<FiberRoot>>();
  let nextRendererId = 1;

  const hook: DevToolsHookShim = {
    // React checks both of these before it will inject.
    isDisabled: false,
    supportsFiber: true,
    renderers,

    inject(internals: unknown): number {
      const id = nextRendererId++;
      renderers.set(id, internals);
      fiberRoots.set(id, new Set());
      return id;
    },

    getFiberRoots(rendererId: number): Set<FiberRoot> {
      let roots = fiberRoots.get(rendererId);
      if (!roots) {
        roots = new Set();
        fiberRoots.set(rendererId, roots);
      }
      return roots;
    },

    onCommitFiberRoot(rendererId: number, root: FiberRoot): void {
      const roots = hook.getFiberRoots(rendererId);
      // React DevTools' own mounted test: a root whose element has gone null has
      // been unmounted. Dropping it here is what keeps stopped surfaces (a modal,
      // a torn-down root) from lingering as dead roots we'd later hit-test against
      // — the job `onCommitFiberUnmount` would otherwise do, at a fraction of the
      // call volume.
      if (root.current?.memoizedState?.element != null) {
        roots.add(root);
      } else {
        roots.delete(root);
      }
    },
  };
  return hook;
}

/**
 * Install the shim, unless a hook is already present.
 *
 * A hook already being there means either React DevTools or React Native's dev
 * setup got here first — both are strictly better than this one, and replacing
 * either would break the real DevTools connection. So an existing hook always
 * wins, and this returns false.
 *
 * Returns true only when it installed a hook that wasn't there. Idempotent: a
 * second call finds its own hook and no-ops.
 */
export function installDevToolsHookShim(): boolean {
  const container = globalThis as HookGlobal;
  if (container.__REACT_DEVTOOLS_GLOBAL_HOOK__ != null) {
    return false;
  }
  const hook = createHook() as DevToolsHookShim & { [OURS]?: true };
  hook[OURS] = true;
  container.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
  return true;
}

/**
 * Whether the hook currently on the global is our shim rather than a real
 * DevTools one. The drawer uses this to explain *why* an element resolved to
 * read-only React data: with our shim there is a fiber tree to read but no
 * `overrideProps` to write through, since that comes from the renderer's dev
 * bundle and a release build doesn't ship one.
 */
export function isHookShimInstalled(): boolean {
  const hook = (globalThis as HookGlobal).__REACT_DEVTOOLS_GLOBAL_HOOK__ as
    { [OURS]?: true } | undefined;
  return hook?.[OURS] === true;
}

/** Remove our shim, if it's ours. Used on teardown so a reinstall starts clean. */
export function uninstallDevToolsHookShim(): void {
  if (isHookShimInstalled()) {
    delete (globalThis as HookGlobal).__REACT_DEVTOOLS_GLOBAL_HOOK__;
  }
}
