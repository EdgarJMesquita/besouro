/**
 * The initial row across a reload.
 *
 * A full JS reload tears down the heap, so nothing the inspector remembers survives
 * it — and the store is rebuilt at its initial state. The previous session is
 * *adopted*, so the pre-reload rows stay above the new baseline in one timeline,
 * which is exactly why that baseline has to be written and has to say what it is:
 * without it the pane shows the last pre-reload value, then a change diffed against
 * the fresh one, with the reset recorded nowhere.
 *
 * The native module is the only thing that can still tell a reload happened, which
 * is why the flag is native and not a `WeakSet`. The other kind of repeat — a
 * re-install inside one live runtime, where the store object survives holding its
 * current value — *is* a duplicate and is still skipped; `index.test.ts` covers it
 * as "ignores a re-install of the same store".
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { ZustandEvent } from '../../../core/types';

const NATIVE_PATH = '../../../native/NativeBesouro';

interface FakeStore {
  getState: () => { count: number };
  setState: (next: { count: number }) => void;
  subscribe: (
    listener: (next: { count: number }, prev: { count: number }) => void
  ) => () => void;
}

function createFakeStore(): FakeStore {
  let state = { count: 0 };
  const listeners = new Set<
    (next: { count: number }, prev: { count: number }) => void
  >();
  return {
    getState: () => state,
    setState: (next) => {
      const prev = state;
      state = next;
      for (const listener of listeners) listener(state, prev);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
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
  const { installZustandInspector } =
    require('../interceptor') as typeof import('../interceptor');
  return { captured, installZustandInspector };
}

describe('zustand initial row across a reload', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('records the initial state on a cold start', () => {
    const { captured, installZustandInspector } = load(false);
    installZustandInspector({ counter: createFakeStore() });

    expect(captured.eventsOf('zustand')).toHaveLength(1);
  });

  it('records a fresh one on a warm reload, marked as the reload', () => {
    // The store really is back at its initial state: `create` ran again. The row
    // the adopted session already holds describes a store that no longer exists.
    const { captured, installZustandInspector } = load(true);
    installZustandInspector({ counter: createFakeStore() });

    const events = captured.eventsOf<ZustandEvent>('zustand');
    expect(events).toHaveLength(1);
    expect(events[0]?.isInitial).toBe(true);
    expect(events[0]?.isReload).toBe(true);
  });

  it('leaves the cold-start row unmarked', () => {
    const { captured, installZustandInspector } = load(false);
    installZustandInspector({ counter: createFakeStore() });

    expect(captured.eventsOf<ZustandEvent>('zustand')[0]?.isReload).toBe(false);
  });

  it('still records changes after a warm reload', () => {
    const { captured, installZustandInspector } = load(true);
    const store = createFakeStore();
    installZustandInspector({ counter: store });
    captured.reset();

    store.setState({ count: 1 });

    const events = captured.eventsOf<ZustandEvent>('zustand');
    expect(events).toHaveLength(1);
    expect(events[0]?.isInitial).toBe(false);
    expect(events[0]?.isReload).toBe(false);
  });
});
