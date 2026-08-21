/**
 * Jotai inspector — a hand-rolled fake reproduces the v2 store contract this
 * inspector uses (`get` / `sub`), so nothing here depends on the real package.
 *
 * The fake is faithful about the detail that shapes the capture code: jotai's
 * `sub` hands its listener **nothing**. The new value comes from a `get`, and the
 * previous one is whatever the caller remembered — which is why `attachAtom` keeps
 * it rather than reading it back off the store.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import { installJotaiInspector } from '../interceptor';
import { recordCaptures } from '../../../core/__tests__/capture-recorder';
import { startSession } from '../../../core/session';
import { getJotaiAtoms, clearJotaiAtoms } from '../store/atoms';
import { clearLiveState, readLiveState } from '../../../core/live-state';
import type { JotaiEvent } from '../../../core/types';
import type { JotaiAtomLike, JotaiStoreLike } from '../types';

const captured = recordCaptures();

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
      // Listeners are told *that* something changed, never what.
      for (const listener of subscribers.get(target) ?? []) {
        listener();
      }
    },
  };
}

function jotaiEvents(): JotaiEvent[] {
  return captured.eventsOf<JotaiEvent>('jotai');
}

describe('jotai inspector', () => {
  beforeEach(() => {
    captured.reset();
    captured.attach();
    clearJotaiAtoms();
    clearLiveState();
    startSession();
  });

  it('writes the initial row when capture gets a sink, not at install', () => {
    // `init()` installs inspectors and only *then* opens the database, so a row
    // captured at install has nowhere to go and is dropped. The tab reads values
    // from the rows now, so for an atom nobody touches this session that dropped row
    // is the atom's entire presence in the tab.
    captured.detach();
    const store = createFakeStore();
    const countAtom = atom(0);
    installJotaiInspector({ store, atoms: { count: countAtom } });

    expect(jotaiEvents()).toHaveLength(0);

    captured.attach();

    const initial = jotaiEvents().find((event) => event.isInitial);
    expect(initial?.atomName).toBe('count');
    expect(initial?.value).toBe('0');
  });

  it('records the value capture actually started from', () => {
    // An atom that moved while the database was opening: the initial row is read
    // when the sink arrives, so it describes the atom then — not a value that was
    // already stale before anything could be written.
    captured.detach();
    const store = createFakeStore();
    const countAtom = atom(0);
    installJotaiInspector({ store, atoms: { count: countAtom } });
    store.write(countAtom, 7);

    captured.attach();

    expect(jotaiEvents()).toHaveLength(1);
    expect(jotaiEvents()[0]?.value).toBe('7');
  });

  it('records the initial value as a row, and registers the atom', () => {
    const store = createFakeStore();
    const countAtom = atom(0);

    installJotaiInspector({ store, atoms: { count: countAtom } });

    // The row is where the value lives: the tab reads it back from here, in this
    // session and in this session read weeks later.
    const initial = jotaiEvents().find((event) => event.isInitial);
    expect(initial?.atomName).toBe('count');
    expect(initial?.value).toBe('0');

    // The registry knows only what no row can say: that this launch subscribed.
    const [info] = getJotaiAtoms();
    expect(info?.atomName).toBe('count');
    expect(info?.attached).toBe(true);
    expect(info).not.toHaveProperty('value');
  });

  it('registers an atom whose initial read throws, so it is not invisible', () => {
    const store = createFakeStore();
    const brokenAtom = atom(0);
    const broken = {
      ...store,
      get: () => {
        throw new Error('nope');
      },
    };

    installJotaiInspector({ store: broken, atoms: { broken: brokenAtom } });

    // No row landed — the throw was swallowed by safeCapture — so the registry is
    // the only thing standing between this atom and disappearing from the tab.
    expect(jotaiEvents()).toHaveLength(0);
    expect(getJotaiAtoms()[0]?.atomName).toBe('broken');
  });

  it('reads the new value itself, since sub reports nothing', () => {
    const store = createFakeStore();
    const countAtom = atom(0);
    installJotaiInspector({ store, atoms: { count: countAtom } });

    store.write(countAtom, 1);

    // The new value reaches the UI as a row, not as a registry entry: the newest
    // row per atom *is* the atom's current value.
    const change = jotaiEvents().find((event) => !event.isInitial);
    expect(change?.value).toBe('1');
  });

  it('previews a primitive atom by its value', () => {
    // The case Zustand never has: `atom(0)` has no keys to list, so a history row
    // would say nothing at all without the preview.
    const store = createFakeStore();
    const statusAtom = atom('idle');
    installJotaiInspector({ store, atoms: { status: statusAtom } });

    store.write(statusAtom, 'ready');

    const change = jotaiEvents().find((event) => !event.isInitial);
    // `safeStringify` returns a string bare rather than JSON-quoted, which is what
    // a one-line preview wants.
    expect(change?.preview).toBe('ready');
    expect(change?.changedKeys).toEqual([]);
  });

  it('previews an object atom by its contents, and names its changed keys', () => {
    const store = createFakeStore();
    const cartAtom = atom({ items: [], total: 0 });
    installJotaiInspector({ store, atoms: { cart: cartAtom } });

    store.write(cartAtom, { items: ['A1'], total: 0 });

    const change = jotaiEvents().find((event) => !event.isInitial);
    // The head of the serialized value, not a rendering of its shape: what the
    // value *is* beats being told again that it is an object with two keys.
    expect(change?.preview).toBe('{"items":["A1"],"total":0}');
    expect(change?.changedKeys).toEqual(['items']);
  });

  it('watches each declared atom under its own name', () => {
    const store = createFakeStore();
    const a = atom(1);
    const b = atom(2);
    installJotaiInspector({ store, atoms: { first: a, second: b } });
    captured.reset();

    store.write(b, 3);

    const change = jotaiEvents()[0];
    expect(change?.atomName).toBe('second');
    expect(getJotaiAtoms()).toHaveLength(2);
  });

  it('ignores a re-install of the same atom', () => {
    // Fast Refresh re-runs the consumer's devtools module. Without the guard the
    // atom is subscribed twice and gets a second initial row, which the tab reads as
    // a change to the value it already held.
    const store = createFakeStore();
    const countAtom = atom(0);
    installJotaiInspector({ store, atoms: { count: countAtom } });
    installJotaiInspector({ store, atoms: { count: countAtom } });

    expect(jotaiEvents().filter((event) => event.isInitial)).toHaveLength(1);

    store.write(countAtom, 1);
    expect(jotaiEvents().filter((event) => !event.isInitial)).toHaveLength(1);
  });

  it('stops recording and marks the atom detached after detach', () => {
    const store = createFakeStore();
    const countAtom = atom(0);
    const uninstall = installJotaiInspector({
      store,
      atoms: { count: countAtom },
    });

    uninstall();
    store.write(countAtom, 99);

    expect(jotaiEvents().filter((event) => !event.isInitial)).toHaveLength(0);
    expect(getJotaiAtoms()[0]?.attached).toBe(false);
  });

  it('keeps a long preview to one clipped line', () => {
    const store = createFakeStore();
    const noteAtom = atom('');
    installJotaiInspector({ store, atoms: { note: noteAtom } });
    captured.reset();

    store.write(noteAtom, `line one\nline two ${'y'.repeat(300)}`);

    const preview = jotaiEvents()[0]?.preview ?? '';
    expect(preview).not.toContain('\n');
    expect(preview.startsWith('line one line two')).toBe(true);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('truncates an oversized value', () => {
    const store = createFakeStore();
    const blobAtom = atom('');
    installJotaiInspector({ store, atoms: { blob: blobAtom } });
    captured.reset();

    store.write(blobAtom, 'x'.repeat(600_000));

    expect(jotaiEvents()[0]?.valueTruncated).toBe(true);
  });

  it('leaves the atom readable for a pane that has no row to read', () => {
    // What the Current Value pane falls back to once Clear has deleted the rows:
    // the log is the reader's to empty, the atom's value is not.
    const store = createFakeStore();
    const counterAtom = atom(0);
    installJotaiInspector({ store, atoms: { counter: counterAtom } });
    const atomId = getJotaiAtoms()[0]?.atomId as string;

    store.write(counterAtom, 9);

    expect(readLiveState(atomId)?.raw).toBe('9');
  });

  it('stops answering as a live atom after detach', () => {
    const store = createFakeStore();
    const counterAtom = atom(0);
    const uninstall = installJotaiInspector({
      store,
      atoms: { counter: counterAtom },
    });
    const atomId = getJotaiAtoms()[0]?.atomId as string;

    uninstall();

    // Still listed (`attached: false`), but nothing is following it any more, so the
    // pane must not present its value as current.
    expect(readLiveState(atomId)).toBeNull();
  });
});
