/**
 * Zustand inspector — a hand-rolled fake store reproduces zustand's structural
 * contract (`getState` / `setState` / `subscribe((next, prev) => …)`) so we can
 * drive transitions without depending on the real package.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import { installZustandInspector } from '../interceptor';
import { recordCaptures } from '../../../core/__tests__/capture-recorder';
import { startSession } from '../../../core/session';
import { getZustandStores, clearZustandStores } from '../store/stores';
import { clearLiveState, readLiveState } from '../../../core/live-state';
import type { ZustandEvent } from '../../../core/types';

interface FakeStore<State extends object> {
  getState: () => State;
  setState: (partial: Partial<State>) => void;
  subscribe: (
    listener: (nextState: State, prevState: State) => void
  ) => () => void;
}

/** Records what capture hands to persistence — see capture-recorder. */
const captured = recordCaptures();

function createFakeStore<State extends object>(
  initial: State
): FakeStore<State> {
  let state = initial;
  const listeners = new Set<(next: State, prev: State) => void>();
  return {
    getState: () => state,
    setState: (partial) => {
      const prevState = state;
      state = { ...state, ...partial };
      for (const listener of listeners) {
        listener(state, prevState);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function zustandEvents(): ZustandEvent[] {
  return captured.eventsOf<ZustandEvent>('zustand');
}

describe('zustand inspector', () => {
  beforeEach(() => {
    captured.reset();
    captured.attach();
    clearZustandStores();
    clearLiveState();
    startSession();
  });

  it('writes the initial row when capture gets a sink, not at install', () => {
    // `init()` installs inspectors and only *then* opens the database, so a row
    // captured at install has nowhere to go and is dropped. The tab reads state from
    // the rows now, so for a store nobody touches this session that dropped row is
    // the store's entire presence in the tab.
    captured.detach();
    const fakeStore = createFakeStore({ count: 0 });
    installZustandInspector({ counter: fakeStore });

    expect(zustandEvents()).toHaveLength(0);

    captured.attach();

    const initial = zustandEvents().find((event) => event.isInitial);
    expect(initial?.storeName).toBe('counter');
    expect(initial?.state).toContain('"count":0');
  });

  it('records the state capture actually started from', () => {
    // A store that moved while the database was opening: the initial row is read
    // when the sink arrives, so it describes the store then — not a value that was
    // already stale before anything could be written.
    captured.detach();
    const fakeStore = createFakeStore({ count: 0 });
    installZustandInspector({ counter: fakeStore });
    fakeStore.setState({ count: 7 });

    captured.attach();

    expect(zustandEvents()).toHaveLength(1);
    expect(zustandEvents()[0]?.state).toContain('"count":7');
  });

  it('records the initial state as a row, and registers the store', () => {
    const fakeStore = createFakeStore({ count: 0, name: 'a' });

    installZustandInspector({ counter: fakeStore });

    // The row is where the state lives: the tab reads it back from here, in this
    // session and in this session read weeks later.
    const initial = zustandEvents().find((event) => event.isInitial);
    expect(initial).toBeDefined();
    expect(initial?.storeName).toBe('counter');
    expect(initial?.changedKeys.sort()).toEqual(['count', 'name']);
    expect(initial?.state).toContain('"count":0');

    // The registry knows only what no row can say: that this launch subscribed.
    const stores = getZustandStores();
    expect(stores).toHaveLength(1);
    expect(stores[0]?.storeName).toBe('counter');
    expect(stores[0]?.attached).toBe(true);
    expect(stores[0]).not.toHaveProperty('state');
  });

  it('registers a store whose initial read throws, so it is not invisible', () => {
    const fakeStore = createFakeStore({ count: 0 });
    const broken = {
      ...fakeStore,
      getState: () => {
        throw new Error('nope');
      },
    };

    installZustandInspector({ counter: broken });

    // No row landed — the throw was swallowed by safeCapture — so the registry is
    // the only thing standing between this store and disappearing from the tab.
    expect(zustandEvents()).toHaveLength(0);
    expect(getZustandStores()[0]?.storeName).toBe('counter');
  });

  it('records only the changed top-level keys on a state change', () => {
    const fakeStore = createFakeStore({ count: 0, name: 'a' });
    installZustandInspector({ counter: fakeStore });

    fakeStore.setState({ count: 1 });

    // The new state reaches the UI as a row, not as a registry entry: the newest
    // row per store *is* the store's current state.
    const change = zustandEvents().find((event) => !event.isInitial);
    expect(change).toBeDefined();
    expect(change?.changedKeys).toEqual(['count']);
    expect(change?.state).toContain('"count":1');
  });

  it('ignores a re-install of the same store', () => {
    // Fast Refresh re-runs the consumer's devtools module. Without the guard the
    // store is subscribed twice and gets a second initial row, which the tab reads
    // as a change to the value it already held.
    const fakeStore = createFakeStore({ count: 0 });
    installZustandInspector({ counter: fakeStore });
    installZustandInspector({ counter: fakeStore });

    expect(zustandEvents().filter((event) => event.isInitial)).toHaveLength(1);

    fakeStore.setState({ count: 1 });
    expect(zustandEvents().filter((event) => !event.isInitial)).toHaveLength(1);
  });

  it('stops recording and marks the store detached after detach', () => {
    const fakeStore = createFakeStore({ count: 0 });
    const uninstall = installZustandInspector({ counter: fakeStore });

    uninstall();
    fakeStore.setState({ count: 99 });

    const changes = zustandEvents().filter((event) => !event.isInitial);
    expect(changes).toHaveLength(0);
    expect(getZustandStores()[0]?.attached).toBe(false);
  });

  it('leaves the store readable for a pane that has no row to read', () => {
    // What the Current State pane falls back to once Clear has deleted the rows:
    // the log is the reader's to empty, the store's contents are not.
    const fakeStore = createFakeStore({ count: 0 });
    installZustandInspector({ counter: fakeStore });
    const storeId = getZustandStores()[0]?.storeId as string;

    fakeStore.setState({ count: 3 });

    expect(readLiveState(storeId)?.raw).toContain('"count":3');
  });

  it('stops answering as a live store after detach', () => {
    const fakeStore = createFakeStore({ count: 0 });
    const uninstall = installZustandInspector({ counter: fakeStore });
    const storeId = getZustandStores()[0]?.storeId as string;

    uninstall();

    // Still listed (`attached: false`), but nothing is following it any more, so the
    // pane must not present its state as current.
    expect(readLiveState(storeId)).toBeNull();
  });
});
