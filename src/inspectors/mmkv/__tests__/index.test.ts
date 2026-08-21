/**
 * MMKV inspector — hand-rolled fakes reproduce the structural contract of each
 * library generation, so the tests cover all three without depending on the real
 * package (which needs a native build to instantiate at all).
 *
 * The three fakes matter because the inspector behaves differently against each:
 * a v3-shaped instance (`delete`) and a v4-shaped one (`remove`) both take method
 * wrappers, while a *sealed* instance stands in for v4's C++ HybridObject, whose
 * slots refuse one — that is the case the listener fallback exists for.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

import { installMMKVInspector } from '../interceptor';
import { recordCaptures } from '../../../core/__tests__/capture-recorder';
import { startSession } from '../../../core/session';
import { setEventSink } from '../../../core/capture/record';
import { clearMMKVInstances, getMMKVInstances } from '../store/instances';
import type { MMKVEvent } from '../../../core/types';
import type { MMKVLike } from '../types';

let captured = recordCaptures();

type Stored = boolean | string | number | ArrayBuffer;

/**
 * A fake MMKV instance. `removalName` picks the generation: v2/v3 spell removal
 * `delete`, v4 spells it `remove` and returns whether the key was there.
 */
function createFakeMMKV(
  removalName: 'remove' | 'delete' = 'remove',
  id = 'mmkv.default'
): MMKVLike & { storage: Map<string, Stored>; getAllKeysCalls: number } {
  const storage = new Map<string, Stored>();
  const listeners = new Set<(key: string) => void>();
  const notify = (key: string) => {
    for (const listener of listeners) {
      listener(key);
    }
  };

  const instance: MMKVLike & {
    storage: Map<string, Stored>;
    getAllKeysCalls: number;
  } = {
    id,
    storage,
    getAllKeysCalls: 0,
    set(key, value) {
      if (key === '') {
        throw new Error('Cannot set a value for an empty key!');
      }
      storage.set(key, value);
      notify(key);
    },
    getString: (key) => {
      const value = storage.get(key);
      return typeof value === 'string' ? value : undefined;
    },
    getNumber: (key) => {
      const value = storage.get(key);
      return typeof value === 'number' ? value : undefined;
    },
    getBoolean: (key) => {
      const value = storage.get(key);
      return typeof value === 'boolean' ? value : undefined;
    },
    getBuffer: (key) => {
      const value = storage.get(key);
      return value instanceof ArrayBuffer ? value : undefined;
    },
    contains: (key) => storage.has(key),
    getAllKeys: () => {
      instance.getAllKeysCalls += 1;
      return [...storage.keys()];
    },
    clearAll() {
      const keys = [...storage.keys()];
      storage.clear();
      for (const key of keys) {
        notify(key);
      }
    },
    addOnValueChangedListener(onValueChanged) {
      listeners.add(onValueChanged);
      return {
        remove: () => {
          listeners.delete(onValueChanged);
        },
      };
    },
  };

  if (removalName === 'remove') {
    instance.remove = (key: string) => {
      const existed = storage.delete(key);
      if (existed) {
        notify(key);
      }
      return existed;
    };
  } else {
    instance.delete = (key: string) => {
      if (storage.delete(key)) {
        notify(key);
      }
    };
  }
  return instance;
}

/**
 * A v4 HybridObject stand-in: every method slot refuses a wrapper. `Object.freeze`
 * is the closest JS analogue — assignment throws in strict mode, exactly as it does
 * against a native-backed prototype.
 */
function sealMethods<T extends MMKVLike>(instance: T): T {
  return Object.freeze(instance);
}

function mmkvEvents(): MMKVEvent[] {
  return captured.eventsOf<MMKVEvent>('mmkv');
}

/** The change log — every row but the instance's one snapshot row. */
function changes(): MMKVEvent[] {
  return mmkvEvents().filter((event) => !event.isFinal);
}

/** An instance's snapshot row, with its contents parsed back out. */
function contentsOf(instanceName = 'default'): Record<string, string> | null {
  const snapshot = mmkvEvents().find(
    (event) => event.isFinal && event.instanceName === instanceName
  );
  return snapshot?.value ? JSON.parse(snapshot.value) : null;
}

describe('mmkv inspector', () => {
  beforeEach(() => {
    // Re-attached each test: a case below detaches the sink deliberately, and the
    // rest must not inherit that.
    captured = recordCaptures();
    captured.reset();
    clearMMKVInstances();
    startSession();
  });

  it('writes existing contents as a snapshot row on attach', () => {
    const instance = createFakeMMKV();
    instance.storage.set('token', 'abc');
    instance.storage.set('count', 7);

    installMMKVInspector({ default: instance });

    // Contents reach the database immediately, so an instance that is only ever
    // read still has something to show — and still appears in the tab's list.
    expect(contentsOf()).toEqual({ count: '7', token: 'abc' });
    // Attach snapshots; it does not log. The change history is writes only.
    expect(changes()).toHaveLength(0);
  });

  it('records what it knows about the attachment, outside the rows', () => {
    const instance = createFakeMMKV();
    installMMKVInspector({ default: instance });

    const [info] = getMMKVInstances();
    expect(info?.instanceName).toBe('default');
    expect(info?.storageId).toBe('mmkv.default');
    expect(info?.captureMode).toBe('patched');
    expect(info?.attached).toBe(true);
  });

  it('keeps one snapshot row per instance, patched in place', () => {
    jest.useFakeTimers();
    try {
      const instance = createFakeMMKV();
      installMMKVInspector({ default: instance });

      instance.set('a', 1);
      jest.advanceTimersByTime(2_000);
      instance.set('b', 2);
      jest.advanceTimersByTime(2_000);

      // Refreshed, not appended: the table does not grow a row per sweep.
      expect(mmkvEvents().filter((event) => event.isFinal)).toHaveLength(1);
      expect(contentsOf()).toEqual({ a: '1', b: '2' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('sweeps immediately on the first write of an interval', () => {
    jest.useFakeTimers();
    try {
      const instance = createFakeMMKV();
      installMMKVInspector({ default: instance });

      // Past the throttle, so this write is the leading edge of a new interval and
      // the Store pane must not have to wait for the timer to catch up.
      jest.advanceTimersByTime(2_000);
      const beforeWrite = instance.getAllKeysCalls;
      instance.set('token', 'abc');

      expect(instance.getAllKeysCalls).toBe(beforeWrite + 1);
      expect(contentsOf()).toEqual({ token: 'abc' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not re-read the store on every write', () => {
    jest.useFakeTimers();
    try {
      const instance = createFakeMMKV();
      installMMKVInspector({ default: instance });
      const afterAttach = instance.getAllKeysCalls;

      instance.set('a', 1);
      instance.set('b', 2);
      instance.set('c', 3);

      // A change only marks the instance dirty; the sweep waits for the throttle.
      expect(instance.getAllKeysCalls).toBe(afterAttach);
      jest.advanceTimersByTime(2_000);
      expect(instance.getAllKeysCalls).toBe(afterAttach + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('records a set with its value and type, and delegates to the store', () => {
    const instance = createFakeMMKV();
    installMMKVInspector({ default: instance });

    instance.set('token', 'abc');

    expect(instance.storage.get('token')).toBe('abc');
    const [event] = changes();
    expect(event?.operation).toBe('set');
    expect(event?.key).toBe('token');
    expect(event?.valueType).toBe('string');
    expect(event?.value).toBe('abc');
    expect(event?.direction).toBe('write');
    expect(event?.instanceName).toBe('default');
  });

  it('types each value by what was stored, not by coercion', () => {
    const instance = createFakeMMKV();
    installMMKVInspector({ default: instance });

    instance.set('s', 'text');
    instance.set('n', 42);
    instance.set('b', false);
    instance.set('buf', new ArrayBuffer(8));

    expect(changes().map((event) => [event.valueType, event.value])).toEqual([
      ['string', 'text'],
      ['number', '42'],
      // `false` and `0` are values, not absences — the readers check for undefined.
      ['boolean', 'false'],
      ['buffer', '<binary, 8 bytes>'],
    ]);
  });

  it('records a removal under one name whichever the library spells', () => {
    for (const removalName of ['remove', 'delete'] as const) {
      captured.reset();
      clearMMKVInstances();
      const instance = createFakeMMKV(removalName);
      instance.storage.set('token', 'abc');
      installMMKVInspector({ default: instance });

      instance[removalName]?.('token');

      const [event] = changes();
      expect(event?.operation).toBe('remove');
      expect(event?.key).toBe('token');
      expect(event?.direction).toBe('delete');
    }
  });

  it('records a clear as one operation when the method is patchable', () => {
    const instance = createFakeMMKV();
    instance.storage.set('a', 1);
    instance.storage.set('b', 2);
    installMMKVInspector({ default: instance });

    instance.clearAll();

    const events = changes();
    expect(events).toHaveLength(1);
    expect(events[0]?.operation).toBe('clearAll');
    expect(events[0]?.key).toBeUndefined();
  });

  it('captures the error a failed set throws, and rethrows it', () => {
    const instance = createFakeMMKV();
    installMMKVInspector({ default: instance });

    expect(() => instance.set('', 'x')).toThrow('empty key');

    const [event] = changes();
    expect(event?.operation).toBe('set');
    expect(event?.error).toContain('empty key');
  });

  it('keys each instance separately', () => {
    const first = createFakeMMKV('remove', 'mmkv.default');
    const second = createFakeMMKV('remove', 'mmkv.secure');
    installMMKVInspector({ default: first, secure: second });

    first.set('a', 1);
    second.set('b', 2);

    const events = changes();
    const names = events.map((event) => event.instanceName);
    expect(names).toEqual(['default', 'secure']);
    expect(new Set(events.map((event) => event.instanceId)).size).toBe(2);
  });

  it('restores every wrapper on uninstall', () => {
    const instance = createFakeMMKV();
    const originalSet = instance.set;
    const originalRemove = instance.remove;
    const originalClear = instance.clearAll;

    const uninstall = installMMKVInspector({ default: instance });
    expect(instance.set).not.toBe(originalSet);

    uninstall();

    expect(instance.set).toBe(originalSet);
    expect(instance.remove).toBe(originalRemove);
    expect(instance.clearAll).toBe(originalClear);
    expect(getMMKVInstances()[0]?.attached).toBe(false);

    captured.reset();
    instance.set('after', 'detached');
    expect(changes()).toHaveLength(0);
  });

  it('waits for the database before writing the first snapshot', () => {
    jest.useFakeTimers();
    try {
      const instance = createFakeMMKV();
      instance.storage.set('token', 'abc');
      // The window `controller.init()` installs in: the session exists, but the
      // database has not connected, so captured events have nowhere to go and are
      // dropped. Writing the snapshot here would lose the row *and* leave us
      // patching an id that was never inserted for the rest of the session.
      setEventSink(null);

      installMMKVInspector({ default: instance });

      captured = recordCaptures();
      jest.advanceTimersByTime(2_000);

      const snapshot = captured
        .eventsOf<MMKVEvent>('mmkv')
        .find((event) => event.isFinal);
      expect(snapshot?.value).toBe('{"token":"abc"}');
    } finally {
      jest.useRealTimers();
    }
  });

  describe('getters that throw on a type mismatch', () => {
    /**
     * A v4-shaped instance: reached through Nitro's type marshalling, so asking for
     * the wrong type raises instead of returning undefined. The v2/v3 classes and the
     * library's own mock return undefined, which is why this needs its own fake.
     */
    function createStrictMMKV(): MMKVLike & { storage: Map<string, Stored> } {
      const instance = createFakeMMKV();
      const typed =
        <Value>(check: (value: Stored) => boolean) =>
        (key: string): Value | undefined => {
          const value = instance.storage.get(key);
          if (value === undefined) {
            return undefined;
          }
          if (!check(value)) {
            throw new TypeError(`${key} is not of the requested type`);
          }
          return value as Value;
        };
      instance.getString = typed<string>((v) => typeof v === 'string');
      instance.getNumber = typed<number>((v) => typeof v === 'number');
      instance.getBoolean = typed<boolean>((v) => typeof v === 'boolean');
      return instance;
    }

    it('still snapshots every key', () => {
      const instance = createStrictMMKV();
      instance.storage.set('token', 'abc');
      instance.storage.set('launches', 3);
      instance.storage.set('onboarded', true);

      installMMKVInspector({ default: instance });

      // The probe tries getString first, so the boolean and the number both raise
      // before the right getter is reached. Nothing may be lost to that.
      expect(contentsOf()).toEqual({
        launches: '3',
        onboarded: 'true',
        token: 'abc',
      });
    });

    it('does not lose a number or a boolean to a coercing getString', () => {
      // Some v4 builds answer `''` for a key holding another type instead of
      // `undefined`. Taking that at face value typed every number and boolean as an
      // empty string, so both went blank in the Store pane and the operation detail.
      const instance = createFakeMMKV();
      instance.getString = (key: string) => {
        const value = instance.storage.get(key);
        return typeof value === 'string' ? value : '';
      };
      instance.storage.set('launches', 3);
      instance.storage.set('onboarded', false);
      instance.storage.set('theme', 'dark');

      installMMKVInspector({ default: instance });

      expect(contentsOf()).toEqual({
        launches: '3',
        onboarded: 'false',
        theme: 'dark',
      });
    });

    it('still reports a genuinely empty string as one', () => {
      const instance = createFakeMMKV();
      instance.storage.set('blank', '');

      installMMKVInspector({ default: instance });

      // Held back during the probe, but nothing else claimed the key, so it is
      // the answer after all.
      expect(contentsOf()).toEqual({ blank: '' });
    });

    it('does not let a failed sweep cost the change row', () => {
      const instance = createStrictMMKV();
      installMMKVInspector({ default: instance });
      captured.reset();
      // A sweep that blows up entirely, the way an unreadable instance would.
      instance.getAllKeys = () => {
        throw new Error('instance is closed');
      };

      instance.set('token', 'abc');

      const [event] = changes();
      expect(event?.operation).toBe('set');
      expect(event?.key).toBe('token');
    });
  });

  describe('listener fallback', () => {
    it('captures writes when the method slots refuse a wrapper', () => {
      const instance = sealMethods(createFakeMMKV());
      installMMKVInspector({ default: instance });

      expect(getMMKVInstances()[0]?.captureMode).toBe('listener');

      instance.set('token', 'abc');

      const [event] = changes();
      expect(event?.operation).toBe('set');
      expect(event?.key).toBe('token');
      expect(event?.value).toBe('abc');
    });

    it('infers a removal from the key no longer being present', () => {
      const instance = sealMethods(createFakeMMKV());
      installMMKVInspector({ default: instance });
      instance.set('token', 'abc');
      captured.reset();

      instance.remove?.('token');

      const [event] = changes();
      expect(event?.operation).toBe('remove');
      expect(event?.direction).toBe('delete');
    });

    it('reports a clear as one removal per key, which is all it can see', () => {
      const instance = sealMethods(createFakeMMKV());
      installMMKVInspector({ default: instance });
      instance.set('a', 1);
      instance.set('b', 2);
      captured.reset();

      instance.clearAll();

      // The documented cost of the fallback: no `clearAll` row exists to record.
      const events = changes();
      expect(events).toHaveLength(2);
      expect(events.every((event) => event.operation === 'remove')).toBe(true);
    });

    it('stops listening on uninstall', () => {
      const instance = sealMethods(createFakeMMKV());
      const uninstall = installMMKVInspector({ default: instance });

      uninstall();
      captured.reset();
      instance.set('after', 'detached');

      expect(changes()).toHaveLength(0);
    });
  });
});
