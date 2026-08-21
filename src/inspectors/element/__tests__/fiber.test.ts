/**
 * Native tag → fiber resolution: the release-build path, exercised against fiber
 * trees shaped the way React actually builds them, for both renderers (Fabric's
 * `canonical.publicInstance` and Paper's bare `_nativeTag`).
 */

import { describe, it, expect, afterEach } from '@jest/globals';

import { toFiberElement, fiberForNativeTag } from '../fiber';

type TestFiber = {
  tag: number;
  type: unknown;
  elementType: unknown;
  stateNode: unknown;
  memoizedProps: Record<string, unknown> | null;
  return: TestFiber | null;
  child: TestFiber | null;
  sibling: TestFiber | null;
};

function fiber(part: Partial<TestFiber>): TestFiber {
  return {
    tag: 5,
    type: null,
    elementType: null,
    stateNode: null,
    memoizedProps: null,
    return: null,
    child: null,
    sibling: null,
    ...part,
  };
}

/** Link `children` under `parent`, setting sibling and return pointers. */
function withChildren(parent: TestFiber, children: TestFiber[]): TestFiber {
  parent.child = children[0] ?? null;
  children.forEach((child, i) => {
    child.return = parent;
    child.sibling = children[i + 1] ?? null;
  });
  return parent;
}

/**
 * A Fabric host fiber, shaped the way React creates one
 * (`ReactFabric-prod.js:7111`). `publicInstance` is `null` on purpose: React
 * materializes it lazily, and in a release build nothing ever asks it to, so the
 * tag has to come off `canonical` directly.
 */
function fabricHost(nativeTag: number, props: Record<string, unknown>) {
  return fiber({
    tag: 5,
    type: 'RCTView',
    stateNode: {
      node: {},
      canonical: {
        nativeTag,
        viewConfig: { uiViewClassName: 'RCTView' },
        currentProps: props,
        publicInstance: null,
      },
    },
    memoizedProps: props,
  });
}

function installHook(roots: Array<{ current: TestFiber }>): void {
  (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([[1, {}]]),
    getFiberRoots: () => new Set(roots),
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
});

describe('fiberForNativeTag', () => {
  it('is null with no hook — nothing registered a fiber tree', () => {
    expect(fiberForNativeTag(9)).toBe(null);
  });

  it('finds the Fabric host fiber owning a tag', () => {
    const target = fabricHost(9, { title: 'hi' });
    const root = withChildren(fiber({ tag: 3 }), [fabricHost(7, {}), target]);
    installHook([{ current: root }]);
    expect(fiberForNativeTag(9)).toBe(target);
  });

  it('finds the Paper host fiber, whose stateNode is the instance itself', () => {
    const target = fiber({
      tag: 5,
      type: 'RCTView',
      stateNode: { _nativeTag: 12 },
      memoizedProps: {},
    });
    installHook([{ current: withChildren(fiber({ tag: 3 }), [target]) }]);
    expect(fiberForNativeTag(12)).toBe(target);
  });

  it('finds it without a materialized public instance', () => {
    // The regression this module was rewritten for. Reading the tag through
    // `canonical.publicInstance.__nativeTag` works in a dev build, where something
    // has usually already forced the instance into existence, and silently finds
    // null in release — where nothing has. Every host fiber missed, so a release
    // pick never resolved props.
    const target = fabricHost(9, { title: 'hi' });
    const canonical = (target.stateNode as { canonical: unknown })
      .canonical as Record<string, unknown>;
    expect(canonical.publicInstance).toBe(null);
    installHook([{ current: withChildren(fiber({ tag: 3 }), [target]) }]);
    expect(fiberForNativeTag(9)).toBe(target);
  });

  it('ignores non-host fibers that happen to carry a matching tag', () => {
    // A class component whose state coincidentally looks tag-ish must not match.
    const composite = fiber({
      tag: 1,
      stateNode: { _nativeTag: 9 },
    });
    installHook([{ current: withChildren(fiber({ tag: 3 }), [composite]) }]);
    expect(fiberForNativeTag(9)).toBe(null);
  });

  it('is null for a tag no fiber owns, and for the 0 sentinel', () => {
    installHook([
      { current: withChildren(fiber({ tag: 3 }), [fabricHost(7, {})]) },
    ]);
    expect(fiberForNativeTag(999)).toBe(null);
    // 0 is what native reports for a view React doesn't own.
    expect(fiberForNativeTag(0)).toBe(null);
  });
});

describe('toFiberElement', () => {
  const FRAME = { left: 16, top: 52, width: 64, height: 20 };

  it('reads props and the component hierarchy off the fiber', () => {
    const target = fabricHost(9, { title: 'hi', onPress: () => {} });
    const screen = fiber({ tag: 0, type: function ProfileScreen() {} });
    const app = fiber({ tag: 0, type: function App() {} });
    withChildren(app, [screen]);
    withChildren(screen, [target]);
    installHook([{ current: withChildren(fiber({ tag: 3 }), [app]) }]);

    const resolved = toFiberElement(9, FRAME, 'save-btn');
    expect(resolved?.element.origin).toBe('fiber');
    // Outermost first, like the renderer path renders it.
    expect(resolved?.element.hierarchy).toEqual([
      'App',
      'ProfileScreen',
      'RCTView',
    ]);
    expect(resolved?.element.componentName).toBe('RCTView');
    expect(resolved?.element.props.title).toBe('hi');
    // The native hit-test's bounds are used as-is rather than re-measured.
    expect(resolved?.element.frame).toEqual(FRAME);
    expect(resolved?.element.testID).toBe('save-btn');
  });

  it('prefers displayName over name, and skips unnamed fibers', () => {
    const named = Object.assign(function Inner() {}, { displayName: 'Outer' });
    const target = fabricHost(9, {});
    const wrapper = fiber({ tag: 0, type: named });
    // A fragment-like fiber with no type contributes no hierarchy entry.
    const anonymous = fiber({ tag: 7, type: null });
    withChildren(anonymous, [wrapper]);
    withChildren(wrapper, [target]);
    installHook([{ current: withChildren(fiber({ tag: 3 }), [anonymous]) }]);

    expect(toFiberElement(9, FRAME, undefined)?.element.hierarchy).toEqual([
      'Outer',
      'RCTView',
    ]);
  });

  it('is null when no fiber owns the tag', () => {
    installHook([{ current: fiber({ tag: 3 }) }]);
    expect(toFiberElement(9, FRAME, undefined)).toBe(null);
  });
});
