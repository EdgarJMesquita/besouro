/**
 * The baseline row across a reload — the Redux side of the Zustand test, which
 * carries the full reasoning.
 *
 * Redux never suppressed this row: a reload rebuilds the store by re-running the
 * consumer's module, and installing the wrapper dispatches `@@redux/REPLACE`
 * again. What it lacked was any way for the reader to tell that second baseline
 * apart from the first, in a session the reload left adopted and still growing.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { CaptureRecorder } from '../../../core/__tests__/capture-recorder';
import type { ReduxEvent } from '../../../core/types';
import type { ReduxActionLike, ReduxReducerLike } from '../types';

const NATIVE_PATH = '../../../native/NativeBesouro';

interface State {
  count: number;
}

const rootReducer: ReduxReducerLike<State> = (state, action) => {
  const current = state ?? { count: 0 };
  return action.type === 'counter/increment'
    ? { count: current.count + 1 }
    : current;
};

function createFakeStore() {
  let currentReducer = rootReducer;
  let state = currentReducer(undefined, { type: '@@redux/INIT' });
  const store = {
    getState: () => state,
    dispatch: (action: ReduxActionLike) => {
      state = currentReducer(state, action);
      return action;
    },
    replaceReducer: (next: ReduxReducerLike<State>) => {
      currentReducer = next;
      store.dispatch({ type: '@@redux/REPLACE' });
    },
  };
  return store;
}

function load(warm: boolean) {
  jest.doMock(NATIVE_PATH, () => ({
    __esModule: true,
    default: { isWarmReload: () => warm },
  }));
  const recorder =
    require('../../../core/__tests__/capture-recorder') as typeof import('../../../core/__tests__/capture-recorder');
  const session =
    require('../../../core/session') as typeof import('../../../core/session');
  const captured = recorder.recordCaptures();
  session.startSession();
  const { installReduxInspector } =
    require('../interceptor') as typeof import('../interceptor');
  return { captured, installReduxInspector };
}

function baselines(captured: CaptureRecorder): ReduxEvent[] {
  return captured
    .eventsOf<ReduxEvent>('redux')
    .filter((event) => event.isInitial);
}

describe('redux baseline row across a reload', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('marks the baseline as the reload on a warm reload', () => {
    const { captured, installReduxInspector } = load(true);
    const store = createFakeStore();

    installReduxInspector({ store, rootReducer });

    const rows = baselines(captured);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isReload).toBe(true);
  });

  it('leaves the cold-start baseline unmarked', () => {
    const { captured, installReduxInspector } = load(false);
    const store = createFakeStore();

    installReduxInspector({ store, rootReducer });

    const rows = baselines(captured);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isReload).toBe(false);
  });

  it('never marks an action row', () => {
    const { captured, installReduxInspector } = load(true);
    const store = createFakeStore();
    installReduxInspector({ store, rootReducer });

    store.dispatch({ type: 'counter/increment' });

    const action = captured
      .eventsOf<ReduxEvent>('redux')
      .find((event) => event.actionType === 'counter/increment');
    expect(action?.isReload).toBe(false);
  });
});
