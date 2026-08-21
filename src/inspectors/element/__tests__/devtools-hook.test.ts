/**
 * The DevTools hook shim — the piece that makes release-build element inspection
 * possible at all. What matters here is the contract React itself checks before it
 * will inject (`isDisabled`, `supportsFiber`, `inject`) and the root bookkeeping
 * the picker later reads, so the tests drive the hook the way React does rather
 * than asserting on its shape.
 */

import { describe, it, expect, afterEach } from '@jest/globals';

import {
  installDevToolsHookShim,
  isHookShimInstalled,
  uninstallDevToolsHookShim,
} from '../devtools-hook';

type Hook = {
  isDisabled: boolean;
  supportsFiber: boolean;
  renderers: Map<number, unknown>;
  inject(internals: unknown): number;
  getFiberRoots(id: number): Set<unknown>;
  onCommitFiberRoot(id: number, root: unknown): void;
  onCommitFiberUnmount?: unknown;
};

function hook(): Hook {
  return (globalThis as Record<string, unknown>)
    .__REACT_DEVTOOLS_GLOBAL_HOOK__ as Hook;
}

/** A fiber root shaped like the bit of it the hook inspects. */
function root(mounted: boolean) {
  return { current: { memoizedState: { element: mounted ? {} : null } } };
}

afterEach(() => {
  uninstallDevToolsHookShim();
  delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
});

describe('installDevToolsHookShim', () => {
  it('installs a hook React will accept and inject into', () => {
    expect(installDevToolsHookShim()).toBe(true);
    // The exact preconditions React checks before calling inject.
    expect(hook().isDisabled).toBe(false);
    expect(hook().supportsFiber).toBe(true);

    const internals = { bundleType: 0, version: '19.2.0' };
    const id = hook().inject(internals);
    expect(typeof id).toBe('number');
    expect(hook().renderers.get(id)).toBe(internals);
  });

  it('yields to an existing hook rather than replacing it', () => {
    const existing = { isDisabled: false, supportsFiber: true };
    (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ =
      existing;
    expect(installDevToolsHookShim()).toBe(false);
    expect(hook()).toBe(existing);
    expect(isHookShimInstalled()).toBe(false);
  });

  it('is idempotent — a second install finds its own hook', () => {
    expect(installDevToolsHookShim()).toBe(true);
    const first = hook();
    expect(installDevToolsHookShim()).toBe(false);
    expect(hook()).toBe(first);
  });

  it('leaves onCommitFiberUnmount undefined so React short-circuits it', () => {
    installDevToolsHookShim();
    // React guards with `typeof === 'function'`; anything defined here would put
    // us on the per-deleted-fiber path for no benefit.
    expect(hook().onCommitFiberUnmount).toBeUndefined();
  });

  it('only reports the shim as ours', () => {
    expect(isHookShimInstalled()).toBe(false);
    installDevToolsHookShim();
    expect(isHookShimInstalled()).toBe(true);
    uninstallDevToolsHookShim();
    expect(isHookShimInstalled()).toBe(false);
  });

  it('does not uninstall a hook it did not install', () => {
    const existing = { isDisabled: false, supportsFiber: true };
    (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ =
      existing;
    uninstallDevToolsHookShim();
    expect(hook()).toBe(existing);
  });
});

describe('fiber root bookkeeping', () => {
  it('records roots per renderer as they commit', () => {
    installDevToolsHookShim();
    const id = hook().inject({});
    const a = root(true);
    hook().onCommitFiberRoot(id, a);
    expect([...hook().getFiberRoots(id)]).toEqual([a]);

    // Re-committing the same root doesn't duplicate it.
    hook().onCommitFiberRoot(id, a);
    expect(hook().getFiberRoots(id).size).toBe(1);
  });

  it('drops a root once its element goes null (unmounted surface)', () => {
    installDevToolsHookShim();
    const id = hook().inject({});
    const surface = root(true);
    hook().onCommitFiberRoot(id, surface);
    expect(hook().getFiberRoots(id).size).toBe(1);

    // A stopped surface commits with a null element — without this the root
    // would linger and later be searched as if it were still on screen.
    hook().onCommitFiberRoot(id, root(false) as typeof surface);
    (surface.current.memoizedState as { element: unknown }).element = null;
    hook().onCommitFiberRoot(id, surface);
    expect(hook().getFiberRoots(id).size).toBe(0);
  });

  it('keeps each renderer’s roots separate', () => {
    installDevToolsHookShim();
    const first = hook().inject({});
    const second = hook().inject({});
    hook().onCommitFiberRoot(first, root(true));
    expect(hook().getFiberRoots(first).size).toBe(1);
    expect(hook().getFiberRoots(second).size).toBe(0);
  });
});
