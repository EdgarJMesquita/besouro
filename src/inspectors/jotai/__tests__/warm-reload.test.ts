/**
 * The initial row across a reload — the atom-side twin of the Zustand test next to
 * it, which carries the full reasoning: a reload rebuilds the atom at its initial
 * value, so the baseline is recorded again and says why it is there.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { JotaiEvent } from '../../../core/types';
import type { JotaiAtomLike, JotaiStoreLike } from '../types';

const NATIVE_PATH = '../../../native/NativeBesouro';

interface FakeAtom extends JotaiAtomLike {
  initial: unknown;
}

function atom(initial: unknown): FakeAtom {
  return { read: () => initial, initial, toString: () => 'atom' };
}

function createFakeStore(): JotaiStoreLike & {
  write: (target: FakeAtom, value: unknown) => void;
} {
  const values = new Map<FakeAtom, unknown>();
  const subscribers = new Map<FakeAtom, Set<() => void>>();
  return {
    get: (target) => {
      const key = target as FakeAtom;
      return values.has(key) ? values.get(key) : key.initial;
    },
    sub: (target, listener) => {
      const key = target as FakeAtom;
      const set = subscribers.get(key) ?? new Set();
      set.add(listener);
      subscribers.set(key, set);
      return () => set.delete(listener);
    },
    write: (target, value) => {
      values.set(target, value);
      for (const listener of subscribers.get(target) ?? []) listener();
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
  const { installJotaiInspector } =
    require('../interceptor') as typeof import('../interceptor');
  return { captured, installJotaiInspector };
}

describe('jotai initial row across a reload', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('records the initial value on a cold start', () => {
    const { captured, installJotaiInspector } = load(false);
    installJotaiInspector({
      store: createFakeStore(),
      atoms: { count: atom(0) },
    });

    expect(captured.eventsOf('jotai')).toHaveLength(1);
  });

  it('records a fresh one on a warm reload, marked as the reload', () => {
    const { captured, installJotaiInspector } = load(true);
    installJotaiInspector({
      store: createFakeStore(),
      atoms: { count: atom(0) },
    });

    const events = captured.eventsOf<JotaiEvent>('jotai');
    expect(events).toHaveLength(1);
    expect(events[0]?.isInitial).toBe(true);
    expect(events[0]?.isReload).toBe(true);
  });

  it('leaves the cold-start row unmarked', () => {
    const { captured, installJotaiInspector } = load(false);
    installJotaiInspector({
      store: createFakeStore(),
      atoms: { count: atom(0) },
    });

    expect(captured.eventsOf<JotaiEvent>('jotai')[0]?.isReload).toBe(false);
  });

  it('still records changes after a warm reload', () => {
    const { captured, installJotaiInspector } = load(true);
    const store = createFakeStore();
    const countAtom = atom(0);
    installJotaiInspector({ store, atoms: { count: countAtom } });
    captured.reset();

    store.write(countAtom, 1);

    const events = captured.eventsOf<JotaiEvent>('jotai');
    expect(events).toHaveLength(1);
    expect(events[0]?.isInitial).toBe(false);
    expect(events[0]?.isReload).toBe(false);
    expect(events[0]?.value).toBe('1');
  });
});
