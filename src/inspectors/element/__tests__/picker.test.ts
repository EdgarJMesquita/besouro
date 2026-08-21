/**
 * Element inspector — the pieces that can't be exercised on a device in CI:
 * resolving the app's root host instance from the React DevTools global hook
 * (`getRootPublicInstance`), the one-shot native pick wiring (`startElementPick`),
 * and live prop editing (`overrideInspectedProp`). The renderer API and the native
 * module are the only real dependencies, so both are faked: the renderer hit-test
 * on the fake DevTools hook installed below (where the picker reads it from), the
 * TurboModule via a jest.mock so the default import resolves to a stub instead of
 * an unregistered `TurboModuleRegistry.get`.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';

// A stable sentinel standing in for the resolved element's fiber.
const FAKE_FIBER = { __fiber: true };

// Fake the native module so the default import in `../index` resolves here
// instead of running TurboModuleRegistry.get against an unregistered module.
// `__esModule: true` so esModuleInterop unwraps `default` to the object below
// (rather than wrapping it again and exposing `{ default }` as the module).
jest.mock('../../../native/NativeBesouro', () => ({
  __esModule: true,
  default: {
    startElementInspection: jest.fn(),
    openDrawer: jest.fn(),
  },
}));

import {
  getRootPublicInstance,
  startElementPick,
  isElementInspectorAvailable,
  isFullInspectionAvailable,
} from '../picker';
import {
  getInspectedElement,
  clearInspectedElement,
  overrideInspectedProp,
} from '../store/inspection';
import {
  getActiveInspector,
  setActiveInspector,
} from '../../../core/active-inspector-store';

const native = (
  jest.requireMock('../../../native/NativeBesouro') as {
    default: {
      startElementInspection: jest.Mock;
      openDrawer: jest.Mock;
    };
  }
).default;

type FakeFiber = {
  tag: number;
  stateNode: unknown;
  child: FakeFiber | null;
  sibling: FakeFiber | null;
  // Read by the fiber path (release builds); absent on the renderer path.
  type?: unknown;
  memoizedProps?: Record<string, unknown> | null;
  return?: FakeFiber | null;
};

const overrideProps =
  jest.fn<(fiber: unknown, path: unknown, value: unknown) => void>();

/** Fake renderer hit-test: answer with a fixed view for any point. */
const getInspectorDataForViewAtPoint = jest.fn(
  (_view: unknown, _x: number, _y: number, cb: (data: unknown) => void) =>
    cb({
      hierarchy: [{ name: 'App' }, { name: 'Greeting' }],
      selectedIndex: 1,
      props: { title: 'hi', count: 3 },
      source: { fileName: 'App.tsx', lineNumber: 10 },
      frame: { left: 0, top: 0, width: 1, height: 1 },
      touchedViewTag: 48,
      closestInstance: FAKE_FIBER,
    })
);

/**
 * Install a fake DevTools hook whose single root descends to `hostStateNode`.
 *
 * The renderer models a *dev* bundle, so its `rendererConfig` carries
 * `getInspectorDataForInstance` alongside the hit-test — that's the marker the
 * picker reads to tell a real config from the prod bundle's throwing stubs. Pass
 * `prodRenderer` to model a release build instead.
 */
function installHook(
  hostStateNode: unknown,
  containerInfo = 0,
  {
    prodRenderer = false,
    hostType,
    hostProps,
  }: {
    prodRenderer?: boolean;
    /** Set to make the host fiber resolvable by the release/fiber path. */
    hostType?: unknown;
    hostProps?: Record<string, unknown>;
  } = {}
): void {
  const host: FakeFiber = {
    tag: 5, // HostComponent
    stateNode: hostStateNode,
    child: null,
    sibling: null,
    type: hostType,
    memoizedProps: hostProps ?? null,
  };
  const hostRoot: FakeFiber = {
    tag: 3, // HostRoot
    stateNode: null,
    child: host,
    sibling: null,
  };
  host.return = hostRoot;
  const roots = new Set([{ current: hostRoot, containerInfo }]);
  (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map([
      [
        1,
        {
          version: '19.2.0',
          // The prod bundle omits `overrideProps` entirely.
          overrideProps: prodRenderer ? undefined : overrideProps,
          rendererConfig: prodRenderer
            ? {
                // What the prod bundle actually ships: the hit-test is present but
                // throws, and its non-stubbed sibling is left undefined.
                getInspectorDataForInstance: undefined,
                getInspectorDataForViewAtPoint: () => {
                  throw new Error(
                    'getInspectorDataForViewAtPoint() is not available in production.'
                  );
                },
              }
            : {
                getInspectorDataForInstance: () => ({}),
                getInspectorDataForViewAtPoint,
              },
        },
      ],
    ]),
    getFiberRoots: () => roots,
  };
}

function clearHook(): void {
  delete (globalThis as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__;
}

/** The native hit-test path a release-build pick reports: root → touched view. */
const NATIVE_PATH = [
  {
    tag: 1,
    className: 'RCTRootComponentView',
    testID: '',
    left: 0,
    top: 0,
    width: 390,
    height: 844,
  },
  {
    tag: 7,
    className: 'RCTViewComponentView',
    testID: '',
    left: 8,
    top: 40,
    width: 200,
    height: 44,
  },
  {
    tag: 9,
    className: 'RCTParagraphComponentView',
    testID: 'save-btn',
    left: 16,
    top: 52,
    width: 64,
    height: 20,
  },
];

/** Drive a pick to its tap callback and return what it published. */
function pick(path?: unknown[]): void {
  startElementPick();
  const calls = native.startElementInspection.mock.calls;
  const onResult = calls[calls.length - 1]?.[0] as (
    x: number,
    y: number,
    rootTag: number,
    path?: unknown[]
  ) => void;
  onResult(0, 0, 0, path);
}

describe('isElementInspectorAvailable', () => {
  afterEach(clearHook);

  // The pick is native, so it runs with or without React's renderer — only the
  // *detail* degrades. That's what isFullInspectionAvailable reports.
  it('is true with no DevTools hook at all', () => {
    expect(isElementInspectorAvailable()).toBe(true);
    expect(isFullInspectionAvailable()).toBe(false);
  });

  it('reports full inspection for a dev renderer', () => {
    installHook({ _nativeTag: 1 });
    expect(isFullInspectionAvailable()).toBe(true);
  });

  it('does not report full inspection for a prod renderer, whose hit-test is a throwing stub', () => {
    installHook({ _nativeTag: 1 }, 0, { prodRenderer: true });
    expect(isFullInspectionAvailable()).toBe(false);
  });
});

describe('native pick fallback', () => {
  beforeEach(() => clearInspectedElement());
  afterEach(clearHook);

  it('builds an element from the native path when there is no hook', () => {
    pick(NATIVE_PATH);
    const element = getInspectedElement();
    expect(element?.origin).toBe('native');
    expect(element?.componentName).toBe('RCTParagraphComponentView');
    expect(element?.hierarchy).toEqual([
      'RCTRootComponentView',
      'RCTViewComponentView',
      'RCTParagraphComponentView',
    ]);
    // The touched view's own bounds, not the root's.
    expect(element?.frame).toEqual({
      left: 16,
      top: 52,
      width: 64,
      height: 20,
    });
    expect(element?.testID).toBe('save-btn');
    // Nothing to edit, and nothing pretending to be editable.
    expect(element?.props).toEqual({});
    expect(overrideInspectedProp(['title'], 'bye')).toBe(false);
  });

  it('falls back rather than throwing when the renderer is a prod stub', () => {
    installHook({ _nativeTag: 1 }, 0, { prodRenderer: true });
    pick(NATIVE_PATH);
    expect(getInspectedElement()?.origin).toBe('native');
  });

  it('prefers the renderer when it can answer', () => {
    installHook({ _nativeTag: 1 });
    pick(NATIVE_PATH);
    const element = getInspectedElement();
    expect(element?.origin).toBe('renderer');
    expect(element?.componentName).toBe('Greeting');
  });

  it('publishes nothing when neither path yields anything', () => {
    // An older native build invokes the callback without a path argument.
    pick(undefined);
    expect(getInspectedElement()).toBe(null);
  });
});

describe('fiber tier (release build with the hook shim)', () => {
  beforeEach(() => clearInspectedElement());
  afterEach(clearHook);

  /** A release build: prod renderer, plus a fiber owning the touched tag (9). */
  function installReleaseHook(): void {
    installHook({ _nativeTag: 9 }, 0, {
      prodRenderer: true,
      hostType: 'RCTText',
      hostProps: { title: 'hi', onPress: () => {} },
    });
  }

  it('resolves React props from the fiber the native tag points at', () => {
    installReleaseHook();
    pick(NATIVE_PATH);
    const element = getInspectedElement();
    // Not 'native' — there are real React props behind that view.
    expect(element?.origin).toBe('fiber');
    expect(element?.componentName).toBe('RCTText');
    expect(element?.props.title).toBe('hi');
    // Bounds still come from the native hit-test, not a re-measure.
    expect(element?.frame).toEqual({
      left: 16,
      top: 52,
      width: 64,
      height: 20,
    });
  });

  it('refuses prop edits — a prod bundle ships no overrideProps', () => {
    installReleaseHook();
    pick(NATIVE_PATH);
    expect(overrideInspectedProp(['title'], 'bye')).toBe(false);
    // And the displayed value is untouched, not optimistically updated.
    expect(getInspectedElement()?.props.title).toBe('hi');
  });

  it('refuses style edits too — style is a prop like any other', () => {
    installHook({ _nativeTag: 9 }, 0, {
      prodRenderer: true,
      hostType: 'RCTText',
      hostProps: { style: { color: 'red' } },
    });
    pick(NATIVE_PATH);

    expect(overrideInspectedProp(['style'], { color: 'blue' })).toBe(false);
    expect(getInspectedElement()?.props.style).toEqual({ color: 'red' });
  });

  it('falls back to the native chain when no fiber owns the tag', () => {
    // Prod renderer and a hook, but the fiber tree has nothing for tag 9.
    installHook({ _nativeTag: 404 }, 0, {
      prodRenderer: true,
      hostType: 'RCTText',
    });
    pick(NATIVE_PATH);
    expect(getInspectedElement()?.origin).toBe('native');
  });
});

describe('getRootPublicInstance', () => {
  afterEach(clearHook);

  it('returns the Fabric public instance from canonical.publicInstance', () => {
    const publicInstance = { _tag: 'fabric-root' };
    installHook({ canonical: { publicInstance } });
    expect(getRootPublicInstance()).toBe(publicInstance);
  });

  it('returns the Paper stateNode itself (identified by _nativeTag)', () => {
    const stateNode = { _nativeTag: 42 };
    installHook(stateNode);
    expect(getRootPublicInstance()).toBe(stateNode);
  });

  it('returns null when the DevTools hook is absent', () => {
    clearHook();
    expect(getRootPublicInstance()).toBeNull();
  });

  it('skips host fibers whose stateNode is not a recognizable instance', () => {
    installHook({ notAHostInstance: true });
    expect(getRootPublicInstance()).toBeNull();
  });
});

describe('startElementPick', () => {
  beforeEach(() => {
    clearInspectedElement();
    native.startElementInspection.mockReset();
    native.openDrawer.mockReset();
    overrideProps.mockReset();
    setActiveInspector('network');
    installHook({ _nativeTag: 1 });
  });
  afterEach(clearHook);

  /** Run a full pick: start, then drive the native tap callback the module set. */
  function pickAt(x: number, y: number): void {
    startElementPick();
    const onResult = native.startElementInspection.mock.calls[0]?.[0] as
      ((x: number, y: number, rootTag: number) => void) | undefined;
    expect(onResult).toBeDefined();
    onResult?.(x, y, 0);
  }

  it('asks native to start inspection and returns true', () => {
    expect(startElementPick()).toBe(true);
    expect(native.startElementInspection).toHaveBeenCalledTimes(1);
  });

  it('publishes the resolved element, reopens the drawer, and focuses the tab', () => {
    pickAt(12, 34);

    const element = getInspectedElement();
    expect(element?.componentName).toBe('Greeting');
    expect(element?.source).toBe('App.tsx:10');
    expect(element?.props.title).toBe('hi');
    expect(native.openDrawer).toHaveBeenCalledTimes(1);
    expect(getActiveInspector()).toBe('element');
  });

  it('replaces the previous element rather than appending (one at a time)', () => {
    pickAt(1, 1);
    pickAt(2, 2);
    // Still a single current element — no history accumulates.
    expect(getInspectedElement()?.componentName).toBe('Greeting');
  });
});

describe('overrideInspectedProp', () => {
  /** Run a pick, so there is a current element (props `{title:'hi',count:3}`). */
  function seedPick(): void {
    startElementPick();
    const calls = native.startElementInspection.mock.calls;
    const onResult = calls[calls.length - 1]?.[0] as (
      x: number,
      y: number,
      rootTag: number
    ) => void;
    onResult(0, 0, 0);
  }

  /** The props object handed to the renderer by the most recent commit. */
  function lastWrittenProps(): unknown {
    const calls = overrideProps.mock.calls;
    return calls[calls.length - 1]?.[2];
  }

  beforeEach(() => {
    clearInspectedElement();
    native.startElementInspection.mockReset();
    overrideProps.mockReset();
    installHook({ _nativeTag: 1 });
    seedPick();
  });
  afterEach(clearHook);

  it('drives renderer.overrideProps and reflects the new value in the snapshot', () => {
    expect(overrideInspectedProp(['title'], 'bye')).toBe(true);
    // Written as the whole props object (empty path), merged from the element's
    // props — not as a single-path write, which would strand earlier edits.
    expect(overrideProps).toHaveBeenCalledWith(FAKE_FIBER, [], {
      title: 'bye',
      count: 3,
    });
    expect(getInspectedElement()?.props.title).toBe('bye');
  });

  it('replays earlier edits, so a later field cannot revert them', () => {
    overrideInspectedProp(['title'], 'bye');
    overrideInspectedProp(['style'], { color: 'red' });
    overrideInspectedProp(['count'], 7);

    expect(lastWrittenProps()).toEqual({
      title: 'bye',
      count: 7,
      style: { color: 'red' },
    });
    expect(getInspectedElement()?.props).toEqual({
      title: 'bye',
      count: 7,
      style: { color: 'red' },
    });
  });

  it('keeps the latest value per path rather than stacking duplicates', () => {
    overrideInspectedProp(['title'], 'one');
    overrideInspectedProp(['count'], 7);
    overrideInspectedProp(['title'], 'two');

    expect(lastWrittenProps()).toEqual({ title: 'two', count: 7 });
  });

  it('does not replay a write the renderer rejected', () => {
    overrideProps.mockImplementationOnce(() => {
      throw new Error('nope');
    });
    expect(overrideInspectedProp(['title'], 'bye')).toBe(false);
    // The failed value is gone: the next commit rebuilds from the original props.
    overrideInspectedProp(['count'], 7);
    expect(lastWrittenProps()).toEqual({ title: 'hi', count: 7 });
  });

  it('drops the previous element edits when a new element is picked', () => {
    overrideInspectedProp(['title'], 'bye');
    seedPick();
    overrideInspectedProp(['count'], 7);
    expect(lastWrittenProps()).toEqual({ title: 'hi', count: 7 });
  });

  it('returns false once there is no inspected element', () => {
    clearInspectedElement();
    expect(overrideInspectedProp(['title'], 'bye')).toBe(false);
    expect(overrideProps).not.toHaveBeenCalled();
  });
});
