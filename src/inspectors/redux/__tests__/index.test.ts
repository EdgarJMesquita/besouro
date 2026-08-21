/**
 * Redux inspector — a hand-rolled fake reproduces the parts of Redux the capture
 * seam depends on, so nothing here needs the real package.
 *
 * The fake is deliberately faithful about one thing: `applyMiddleware` composes its
 * chain over the *base* dispatch and returns `{ ...store, dispatch }`, so an action
 * a middleware emits internally never passes through the object property a naive
 * patch would replace. That is the whole reason this inspector wraps the reducer,
 * and `captures an action dispatched from inside middleware` is the test that
 * proves it.
 */

import { describe, it, expect, afterEach, beforeEach } from '@jest/globals';

import { FINAL_STATE_ACTION_TYPE, installReduxInspector } from '../interceptor';
import { recordCaptures } from '../../../core/__tests__/capture-recorder';
import { startSession } from '../../../core/session';
import {
  clearReduxSnapshot,
  getReduxFlashPlayed,
  getReduxSnapshot,
  markReduxFlashPlayed,
} from '../store/snapshot';
import type { ReduxEvent } from '../../../core/types';
import type {
  ReduxActionLike,
  ReduxInspectorPeers,
  ReduxReducerLike,
} from '../types';

const captured = recordCaptures();

/**
 * Stand-in for RN's `ErrorUtils`, which `installCrashCapture` wraps. Installed
 * once for the file so the inspector's crash hook has a handler chain to join.
 */
let globalHandler: ((error: unknown, isFatal?: boolean) => void) | undefined;
(globalThis as Record<string, unknown>).ErrorUtils = {
  getGlobalHandler: () => globalHandler,
  setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => {
    globalHandler = handler;
  },
};

/** Drive the installed global handler, as a JS fatal would. */
function fireFatal(): void {
  globalHandler?.(new Error('boom'), true);
}

/**
 * Every install in this file, torn down after each test.
 *
 * Not tidiness: an install leaves a repeating snapshot timer and a link in the
 * `ErrorUtils` handler chain, so leaking them across cases would have later tests
 * firing earlier tests' capture — and would keep the Jest worker alive.
 */
const installed: Array<() => void> = [];
function install<State>(peers: ReduxInspectorPeers<State>): () => void {
  const uninstall = installReduxInspector(peers);
  installed.push(uninstall);
  return uninstall;
}

interface FakeStore<State> {
  getState: () => State;
  dispatch: (action: ReduxActionLike) => unknown;
  replaceReducer: (next: ReduxReducerLike<State>) => void;
}

/** The parts of `createStore` this inspector touches, with Redux's own semantics. */
function createFakeStore<State>(
  reducer: ReduxReducerLike<State>,
  preloaded?: State
): FakeStore<State> {
  let currentReducer = reducer;
  let state = currentReducer(preloaded, { type: '@@redux/INIT' });
  const store: FakeStore<State> = {
    getState: () => state,
    dispatch: (action) => {
      state = currentReducer(state, action);
      return action;
    },
    // Mirrors redux: swap the slot, then dispatch REPLACE through the *base*
    // dispatch, which is what gives the inspector its initial-state pass.
    replaceReducer: (next) => {
      currentReducer = next;
      store.dispatch({ type: '@@redux/REPLACE' });
    },
  };
  return store;
}

/**
 * Stands in for `applyMiddleware(thunk)`: the returned object carries a *new*
 * dispatch, and the thunk is handed that composed closure — not the property on the
 * returned object.
 */
function withThunk<State>(store: FakeStore<State>): FakeStore<State> & {
  dispatch: (action: ReduxActionLike | ThunkAction) => unknown;
} {
  const baseDispatch = store.dispatch;
  const dispatch = (action: ReduxActionLike | ThunkAction): unknown => {
    if (typeof action === 'function') {
      return action(dispatch, store.getState);
    }
    return baseDispatch(action);
  };
  return { ...store, dispatch };
}

type ThunkAction = (
  dispatch: (action: ReduxActionLike | ThunkAction) => unknown,
  getState: () => unknown
) => unknown;

interface AppState {
  cart: { items: string[] };
  auth: { user: string | null };
}

const initialState: AppState = { cart: { items: [] }, auth: { user: null } };

const rootReducer: ReduxReducerLike<AppState> = (state, action) => {
  const current = state ?? initialState;
  switch (action.type) {
    case 'cart/addItem':
      return {
        ...current,
        cart: {
          items: [...current.cart.items, String(action.sku ?? 'unknown')],
        },
      };
    case 'auth/login':
      return { ...current, auth: { user: String(action.user ?? '') } };
    default:
      return current;
  }
};

function reduxEvents(): ReduxEvent[] {
  return captured.eventsOf<ReduxEvent>('redux');
}

describe('redux inspector', () => {
  beforeEach(() => {
    captured.reset();
    // Idempotent, and here so a test that drops the sink cannot leak it forward.
    captured.attach();
    clearReduxSnapshot();
    startSession();
  });

  afterEach(() => {
    while (installed.length > 0) {
      installed.pop()?.();
    }
  });

  it('records an initial row and a live snapshot on install', () => {
    const store = createFakeStore(rootReducer);

    install({ store, rootReducer });

    const initial = reduxEvents().find((event) => event.isInitial);
    expect(initial).toBeDefined();
    expect(initial?.changedKeys.sort()).toEqual(['auth', 'cart']);
    // The one row that carries the whole tree: the session's baseline.
    expect(initial?.changedState).toContain('"items":[]');

    expect(getReduxSnapshot()?.attached).toBe(true);
    expect(getReduxSnapshot()?.state).toEqual(initialState);
  });

  /**
   * The window `init()` opens: inspectors are installed synchronously and the
   * database — the capture sink — is opened after them. The baseline row is
   * produced inside that window, and it is the one row nothing later can
   * reconstruct, since an action row carries only its delta.
   *
   * Easy to miss because the recorder attaches at module scope, which is the one
   * arrangement the real app never has.
   */
  it('still records the initial row when the sink attaches after install', () => {
    const store = createFakeStore(rootReducer);
    captured.detach();

    install({ store, rootReducer });

    // The live pane does not wait on a database, and is filled either way.
    expect(getReduxSnapshot()?.state).toEqual(initialState);
    expect(reduxEvents()).toHaveLength(0);

    captured.attach();

    const initial = reduxEvents().filter((event) => event.isInitial);
    expect(initial).toHaveLength(1);
    expect(initial[0]?.changedState).toContain('"items":[]');
  });

  it('records one row per action, with only the slices that changed', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });

    store.dispatch({ type: 'cart/addItem', sku: 'A1' });

    const action = reduxEvents().find((event) => !event.isInitial);
    expect(action?.actionType).toBe('cart/addItem');
    expect(action?.changedKeys).toEqual(['cart']);
    // `auth` did not change, so it is not in the row at all.
    expect(action?.changedState).toContain('"cart"');
    expect(action?.changedState).not.toContain('"auth"');
  });

  it('keeps everything but `type` as the payload, `meta` included', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });

    store.dispatch({
      type: 'cart/addItem',
      sku: 'A1',
      meta: { requestStatus: 'fulfilled' },
    });

    const action = reduxEvents().find((event) => !event.isInitial);
    expect(action?.payload).toContain('"sku":"A1"');
    expect(action?.payload).toContain('"requestStatus":"fulfilled"');
    expect(action?.payload).not.toContain('cart/addItem');
  });

  it('records an action that changed nothing as changing nothing', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });

    store.dispatch({ type: 'noop/ignored' });

    const action = reduxEvents().find((event) => !event.isInitial);
    expect(action?.actionType).toBe('noop/ignored');
    expect(action?.changedKeys).toEqual([]);
  });

  it('captures an action dispatched from inside middleware', () => {
    // The case that decides the whole design: `createAsyncThunk` and RTK Query
    // dispatch from here, and a `store.dispatch` patch would see none of it.
    const base = createFakeStore(rootReducer);
    install({ store: base, rootReducer });
    const store = withThunk(base);

    store.dispatch((dispatch) => {
      dispatch({ type: 'auth/login', user: 'ada' });
    });

    const types = reduxEvents().map((event) => event.actionType);
    expect(types).toContain('auth/login');
  });

  it('stays installed when the app replaces the reducer itself', () => {
    // combineSlices / lazy reducer injection call this at runtime; without the
    // re-wrap, capture would stop dead here with nothing to explain it.
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });

    store.replaceReducer(rootReducer);
    captured.reset();
    store.dispatch({ type: 'auth/login', user: 'ada' });

    expect(reduxEvents().map((event) => event.actionType)).toContain(
      'auth/login'
    );
  });

  it('restores the original reducer and stops recording on teardown', () => {
    const store = createFakeStore(rootReducer);
    const uninstall = install({ store, rootReducer });

    uninstall();
    captured.reset();
    store.dispatch({ type: 'cart/addItem', sku: 'A1' });

    expect(reduxEvents()).toHaveLength(0);
    expect(getReduxSnapshot()?.attached).toBe(false);
    // The reducer still works — teardown put the consumer's own back.
    expect(store.getState().cart.items).toEqual(['A1']);
  });

  it('does not double-record when install runs twice for one store', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });
    install({ store, rootReducer });
    captured.reset();

    store.dispatch({ type: 'auth/login', user: 'ada' });

    expect(
      reduxEvents().filter((event) => event.actionType === 'auth/login')
    ).toHaveLength(1);
  });

  it('stores the whole value when root state is not a keyed object', () => {
    const listReducer: ReduxReducerLike<number[]> = (state, action) =>
      action.type === 'push' ? [...(state ?? []), 1] : (state ?? []);
    const store = createFakeStore(listReducer);
    install({ store, rootReducer: listReducer });
    captured.reset();

    store.dispatch({ type: 'push' });

    const action = reduxEvents()[0];
    expect(action?.changedKeys).toEqual([]);
    expect(action?.changedState).toBe('[1]');
  });

  it('writes a closing snapshot carrying the whole tree on a JS fatal', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });
    store.dispatch({ type: 'auth/login', user: 'ada' });

    fireFatal();

    const final = reduxEvents().find((event) => event.isFinal);
    expect(final).toBeDefined();
    expect(final?.actionType).toBe(FINAL_STATE_ACTION_TYPE);
    expect(final?.stateIsFull).toBe(true);
    // The whole tree, not the delta the action row carries.
    expect(final?.changedState).toContain('"auth"');
    expect(final?.changedState).toContain('"cart"');
    expect(final?.changedState).toContain('"user":"ada"');
  });

  it('keeps one closing snapshot per session, refreshed in place', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });

    store.dispatch({ type: 'auth/login', user: 'ada' });
    fireFatal();
    store.dispatch({ type: 'cart/addItem', sku: 'A1' });
    fireFatal();

    // Appending a second row per crash would grow the table without bound; the
    // row is patched instead.
    expect(reduxEvents().filter((event) => event.isFinal)).toHaveLength(1);
    const final = reduxEvents().find((event) => event.isFinal);
    expect(final?.changedState).toContain('"A1"');
  });

  it('marks ordinary action rows as carrying a partial state', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });

    store.dispatch({ type: 'auth/login', user: 'ada' });

    const initial = reduxEvents().find((event) => event.isInitial);
    const action = reduxEvents().find(
      (event) => !event.isInitial && !event.isFinal
    );
    expect(initial?.stateIsFull).toBe(true);
    expect(action?.stateIsFull).toBe(false);
    expect(action?.isFinal).toBe(false);
  });

  it('still writes a closing snapshot when no action was ever dispatched', () => {
    // The initial pass marks the state dirty too, so a session that dispatched
    // nothing still ends with a snapshot. That is what lets the archived State
    // view rely on finding one rather than falling back to the initial row.
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });
    captured.reset();

    fireFatal();

    const final = reduxEvents().find((event) => event.isFinal);
    expect(final?.stateIsFull).toBe(true);
    expect(final?.changedState).toContain('"items":[]');
  });

  it('records the nested paths an action changed', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });
    captured.reset();

    store.dispatch({ type: 'auth/login', user: 'ada' });

    const action = reduxEvents()[0];
    // The slice alone (`auth`) is already the action type's prefix; the path
    // inside it is what the log's subtitle can actually tell the reader.
    expect(action?.changedPaths).toEqual(['auth.user']);
    expect(action?.changedKeys).toEqual(['auth']);
  });

  it('truncates an oversized payload on its own budget', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });
    captured.reset();

    store.dispatch({ type: 'cart/addItem', blob: 'x'.repeat(200_000) });

    const action = reduxEvents()[0];
    expect(action?.payloadTruncated).toBe(true);
    expect(action?.changedStateTruncated).toBe(false);
  });
});

describe('change flash bookkeeping', () => {
  /**
   * The Store pane is unmounted every time the reader switches to the action log,
   * so what has already flashed cannot live in the pane. It lives here — and has
   * to be dropped with the snapshot, since revisions restart at 1 and a stale
   * high-water mark would swallow the next store's first flashes.
   */
  it('forgets what it has flashed when the snapshot is cleared', () => {
    const store = createFakeStore(rootReducer);
    install({ store, rootReducer });
    markReduxFlashPlayed(getReduxSnapshot()!.revision);
    expect(getReduxFlashPlayed()).toBeGreaterThan(0);

    clearReduxSnapshot();

    expect(getReduxFlashPlayed()).toBe(0);
  });

  it('only ever moves forward', () => {
    markReduxFlashPlayed(7);
    markReduxFlashPlayed(3);
    expect(getReduxFlashPlayed()).toBe(7);
  });
});
