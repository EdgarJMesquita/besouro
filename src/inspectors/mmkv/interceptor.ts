/**
 * MMKV capture mechanism — internal.
 *
 * An MMKV store is an instance the app creates, not a module singleton, and an app
 * routinely holds several (a default one, an encrypted one, one per user), so the
 * consumer declares the instances to watch in the config:
 * `mmkv({ default: storage })`. Install attaches to each, keyed by the
 * map's names.
 *
 * {@link installMMKVInspector} is the only way in — there is deliberately no
 * per-instance attach export, for the same reason as Zustand and Jotai: attaching an
 * instance created after install would mean calling this library from feature code,
 * planting a static `besouro` import in a module that ships in release and
 * defeating the consumer's single dev-only `require` (§11).
 *
 * **Two capture paths, and why.** The preferred one wraps the instance's own
 * `set` / `remove` (v4) or `delete` (v2, v3) / `clearAll`, which names each operation
 * exactly. That works on v2 and v3, where `MMKV` is an ordinary JS class. v4 returns
 * a Nitro **C++ HybridObject** whose method slots may refuse a wrapper, so when a
 * patch does not take we fall back to the instance's own
 * `addOnValueChangedListener`. The fallback still sees every write, but it is handed
 * only a key: `set` versus `remove` is then inferred from `contains(key)`, and a
 * `clearAll` arrives as a burst of removes rather than one row. Which path an
 * instance is on is recorded on its snapshot so the tab can say so.
 *
 * **Reads are not captured, on purpose.** MMKV's getters are synchronous JSI calls
 * that apps put in render paths precisely because they are cheap; wrapping them
 * taxes the path that was chosen for being untaxed, and a screen re-rendering in a
 * loop would bury the writes under thousands of reads. The tab's Current Contents
 * view shows every key regardless, which is what a reader actually wants from a
 * key/value store.
 *
 * We never import `react-native-mmkv`: `MMKVLike` is a structural subset spanning
 * v2 through v4 (§4.1).
 */

import { patchMethod, safeCapture } from '../../core/base-interceptor';
import {
  captureEvent,
  captureEventSync,
  createEventId,
  flushCapturedSync,
  isCapturing,
  patchEvent,
} from '../../core/capture';
import { getCurrentSession, installCrashCapture } from '../../core/session';
import { truncateToBytes } from '../../core/truncate';
import { safeStringify } from '../../core/serialize';
import type {
  MMKVEvent,
  MMKVOperation,
  MMKVValueType,
  StorageDirection,
} from '../../core/types';
import {
  markMMKVInstanceDetached,
  registerMMKVInstance,
} from './store/instances';
import type { MMKVContents, MMKVInstances, MMKVLike } from './types';

/** Per-entry ceiling for a captured value — 500 KB, matching AsyncStorage. */
const MAX_VALUE_BYTES = 500_000;

/** Ceiling for a whole-instance snapshot row. */
const MAX_SNAPSHOT_BYTES = 500_000;

/**
 * How often a dirty instance's snapshot row is refreshed. Matches the Redux
 * inspector's interval, and for the same reason: often enough that a crash loses
 * little, rare enough that an app writing in a loop does not pay per write.
 */
const SNAPSHOT_INTERVAL_MS = 2_000;

/** What a captured value looks like once serialized. */
interface CapturedValue {
  valueType: MMKVValueType;
  value: string;
  valueTruncated: boolean;
}

export function installMMKVInspector(instances: MMKVInstances): () => void {
  const detachers = Object.entries(instances).map(([name, instance]) =>
    attachMMKV(instance, name)
  );
  const stopSnapshots = startSnapshotWrites();
  return () => {
    stopSnapshots();
    for (const detach of detachers) {
      detach();
    }
  };
}

let attachCount = 0;

/**
 * What the inspector holds per attached instance while it runs.
 *
 * `dirty` is a flag, not a copy: unlike Redux — which is handed its whole state on
 * every dispatch and can keep the reference for free — reading MMKV's contents means
 * sweeping `getAllKeys()` and a getter per key. So a change only *marks* the instance
 * dirty, and the sweep happens at most once per {@link SNAPSHOT_INTERVAL_MS}.
 */
interface Watcher {
  instanceId: string;
  instanceName: string;
  instance: MMKVLike;
  dirty: boolean;
  /** When the contents were last swept, for the leading-edge throttle. */
  lastSweepAt: number;
  /** Id of this session's snapshot row for this instance, once one exists. */
  snapshotId: string | null;
  snapshotSessionId: string | null;
}

const watchers = new Map<string, Watcher>();

/**
 * Note that an instance's contents changed, and sweep now if the throttle allows.
 *
 * Leading-edge rather than trailing-only, which matters more here than the interval
 * length does: an app that writes a key every few seconds is the common case, and
 * with a trailing throttle every one of those writes left the Store pane stale for
 * up to {@link SNAPSHOT_INTERVAL_MS}. Sweeping on the first write of an interval
 * makes the ordinary case immediate while keeping the same ceiling for a burst —
 * the timer still collects whatever the burst leaves dirty.
 */
function markDirty(instanceId: string): void {
  const watcher = watchers.get(instanceId);
  if (!watcher) {
    return;
  }
  watcher.dirty = true;
  if (Date.now() - watcher.lastSweepAt >= SNAPSHOT_INTERVAL_MS) {
    // Guarded separately from the caller: a sweep that fails must cost us the
    // snapshot, never the change row the caller is in the middle of recording.
    safeCapture(() => writeSnapshot(instanceId, false));
  }
}

/**
 * Attach to one instance: wrap its writes (or fall back to its change listener),
 * then read its current contents once into the snapshot registry. Returns a detach
 * that restores every wrapper and marks the instance detached.
 *
 * Module-private on purpose — see the note at the top of this file.
 */
function attachMMKV(instance: MMKVLike, instanceName: string): () => void {
  attachCount += 1;
  const instanceId = `mmkv-${attachCount}`;
  const restores: Array<() => void> = [];

  watchers.set(instanceId, {
    instanceId,
    instanceName,
    instance,
    dirty: false,
    lastSweepAt: 0,
    snapshotId: null,
    snapshotSessionId: null,
  });

  const patched = patchWrites(instance, instanceId, instanceName, restores);
  if (!patched) {
    restores.push(listenForChanges(instance, instanceId, instanceName));
  }

  registerMMKVInstance({
    instanceId,
    instanceName,
    storageId: instance.id,
    captureMode: patched ? 'patched' : 'listener',
  });

  // Snapshot straight away — `lastSweepAt` starts at 0, so this first `markDirty`
  // always sweeps. That gives the Store pane the instance's existing contents before
  // the app writes anything, which for a store read far more often than it is
  // written may be the whole session, and it is what puts every attached instance in
  // the tab's list, since the list is built from rows.
  safeCapture(() => markDirty(instanceId));

  return () => {
    for (const restore of restores) {
      restore();
    }
    watchers.delete(instanceId);
    markMMKVInstanceDetached(instanceId);
  };
}

/**
 * Wrap `set`, the instance's removal method, and `clearAll`, pushing a restore for
 * each. Returns whether *every* wrapper took: a partial patch would capture some
 * operations twice once the listener fallback is also running, so anything short of
 * all three rolls back and hands the instance to the listener instead.
 */
function patchWrites(
  instance: MMKVLike,
  instanceId: string,
  instanceName: string,
  restores: Array<() => void>
): boolean {
  const taken: Array<() => void> = [];

  const setRestore = tryPatch(instance, 'set', (original) => {
    const call = original as MMKVLike['set'];
    return (key: string, value: boolean | string | number | ArrayBuffer) => {
      let failure: unknown;
      try {
        call.call(instance, key, value);
      } catch (error) {
        failure = error;
      }
      safeCapture(() => {
        const captured = describeValue(value);
        if (failure === undefined) {
          markDirty(instanceId);
        }
        record({
          instanceId,
          instanceName,
          operation: 'set',
          key,
          direction: 'write',
          captured,
          error: failure === undefined ? undefined : errorMessage(failure),
        });
      });
      if (failure !== undefined) {
        throw failure;
      }
    };
  });
  if (!setRestore) {
    return false;
  }
  taken.push(setRestore);

  // v4 renamed `delete` to `remove`; an instance has exactly one of them.
  const removalKey: 'remove' | 'delete' =
    typeof instance.remove === 'function' ? 'remove' : 'delete';
  if (typeof instance[removalKey] === 'function') {
    const removeRestore = tryPatch(instance, removalKey, (original) => {
      const call = original as (key: string) => unknown;
      return ((key: string) => {
        const result = call.call(instance, key);
        safeCapture(() => {
          markDirty(instanceId);
          record({
            instanceId,
            instanceName,
            operation: 'remove',
            key,
            direction: 'delete',
          });
        });
        return result;
      }) as MMKVLike[typeof removalKey];
    });
    if (!removeRestore) {
      rollback(taken);
      return false;
    }
    taken.push(removeRestore);
  }

  const clearRestore = tryPatch(instance, 'clearAll', (original) => {
    const call = original as MMKVLike['clearAll'];
    return () => {
      call.call(instance);
      safeCapture(() => {
        markDirty(instanceId);
        record({
          instanceId,
          instanceName,
          operation: 'clearAll',
          direction: 'delete',
        });
      });
    };
  });
  if (!clearRestore) {
    rollback(taken);
    return false;
  }
  taken.push(clearRestore);

  restores.push(...taken);
  return true;
}

/**
 * `patchMethod`, but reporting whether the slot actually took the wrapper.
 *
 * A Nitro HybridObject's methods live on a native-backed prototype, so assigning
 * over one either throws (module code is strict) or silently does nothing. Neither
 * is distinguishable from success at the call site, so we compare the slot before
 * and after and let the caller choose the fallback. Returns null when the wrapper
 * did not stick.
 */
function tryPatch<Key extends keyof MMKVLike>(
  instance: MMKVLike,
  key: Key,
  createWrapper: (original: MMKVLike[Key]) => MMKVLike[Key]
): (() => void) | null {
  const before = instance[key];
  try {
    const restore = patchMethod(instance, key, createWrapper);
    if (instance[key] === before) {
      restore();
      return null;
    }
    return restore;
  } catch {
    return null;
  }
}

function rollback(restores: Array<() => void>): void {
  for (const restore of restores) {
    restore();
  }
}

/**
 * The fallback path: the instance's own change listener. Fires after every `set`
 * and removal with the key that changed, so the operation is inferred from whether
 * the key still exists.
 */
function listenForChanges(
  instance: MMKVLike,
  instanceId: string,
  instanceName: string
): () => void {
  const listener = instance.addOnValueChangedListener((key: string) => {
    safeCapture(() => {
      markDirty(instanceId);
      if (!instance.contains(key)) {
        record({
          instanceId,
          instanceName,
          operation: 'remove',
          key,
          direction: 'delete',
        });
        return;
      }
      const captured = readValue(instance, key);
      record({
        instanceId,
        instanceName,
        operation: 'set',
        key,
        direction: 'write',
        captured,
      });
    });
  });
  return () => {
    listener.remove();
  };
}

/**
 * Every key/value pair in an instance right now, as the flat object a snapshot row
 * carries. Sorted, so a snapshot refreshed mid-session does not reorder the pane
 * under the reader.
 *
 * A key that cannot be read is skipped rather than allowed to abort the sweep. One
 * unreadable key losing the whole snapshot is the difference between a Store pane
 * missing a row and a Store pane that is permanently empty — and because the sweep
 * runs inside `safeCapture`, that failure would be silent.
 */
function readContents(instance: MMKVLike): MMKVContents {
  const contents: MMKVContents = {};
  let keys: string[];
  try {
    keys = instance.getAllKeys().slice();
  } catch {
    return contents;
  }
  for (const key of keys.sort((a, b) => a.localeCompare(b))) {
    contents[key] = readValue(instance, key)?.value ?? '';
  }
  return contents;
}

/**
 * Keep each instance's snapshot row current: on a throttle while writes flow, on
 * background, and on a JS fatal — the same three triggers the Redux inspector uses,
 * for the same reason (§6.9).
 *
 * `installCrashCapture` chains handlers, so this does not displace the session
 * lifecycle's own.
 */
function startSnapshotWrites(): () => void {
  const timer = setInterval(() => {
    for (const instanceId of watchers.keys()) {
      safeCapture(() => writeSnapshot(instanceId, false));
    }
  }, SNAPSHOT_INTERVAL_MS);
  // Never hold the process open for a devtool (Node/Jest; a no-op on Hermes).
  (timer as unknown as { unref?: () => void }).unref?.();

  const restoreCrashCapture = installCrashCapture(() => {
    for (const instanceId of watchers.keys()) {
      safeCapture(() => writeSnapshot(instanceId, true));
    }
  });

  const stopAppState = observeBackground(() => {
    for (const instanceId of watchers.keys()) {
      safeCapture(() => writeSnapshot(instanceId, false));
    }
  });

  return () => {
    clearInterval(timer);
    restoreCrashCapture();
    stopAppState();
  };
}

/** Call `onBackground` when the app leaves the foreground. */
function observeBackground(onBackground: () => void): () => void {
  try {
    const { AppState } =
      require('react-native') as typeof import('react-native');
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        onBackground();
      }
    });
    return () => subscription?.remove();
  } catch {
    // No react-native (tests, web) — the throttle and crash handler still run.
    return () => {};
  }
}

/**
 * Write — or refresh — an instance's snapshot row for the current session.
 *
 * **One row per instance per session**, created on first need and patched in place
 * after, so the table does not grow with a row per sweep however long the session
 * runs. The sweep itself only happens when a change marked the instance dirty, so an
 * idle app costs nothing. `sync` is for the crash path, where nothing asynchronous
 * will get a turn before the process dies.
 */
function writeSnapshot(instanceId: string, sync: boolean): void {
  const watcher = watchers.get(instanceId);
  const session = getCurrentSession();
  if (!watcher || !watcher.dirty || !session) {
    return;
  }
  // Captured events are *dropped* when no queue is attached — the database has not
  // opened yet (see `core/capture/record`). The controller installs inspectors
  // before it connects, so the attach sweep lands in that window: writing here
  // would discard the row and, worse, leave us remembering a `snapshotId` that was
  // never inserted, so every later sweep would patch a row that does not exist and
  // the Store pane would stay empty for the whole session. Staying dirty instead
  // means the next sweep — the timer is already running — creates it for real.
  if (!isCapturing()) {
    return;
  }
  watcher.dirty = false;
  watcher.lastSweepAt = Date.now();

  const { text, truncated } = truncateToBytes(
    safeStringify(readContents(watcher.instance)),
    MAX_SNAPSHOT_BYTES
  );

  // A new session gets its own snapshot row; the previous session's stays where it
  // is, which is the whole point of keeping it.
  if (watcher.snapshotSessionId !== session.id) {
    watcher.snapshotId = null;
    watcher.snapshotSessionId = session.id;
  }

  if (watcher.snapshotId) {
    patchEvent(watcher.snapshotId, 'mmkv', {
      timestamp: Date.now(),
      value: text,
      valueTruncated: truncated,
    } as Partial<MMKVEvent>);
    if (sync) {
      // The patch is sitting in the queue and only a drain will land it.
      flushCapturedSync();
    }
    return;
  }

  watcher.snapshotId = createEventId();
  const snapshotEvent: MMKVEvent = {
    id: watcher.snapshotId,
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'mmkv',
    instanceId: watcher.instanceId,
    instanceName: watcher.instanceName,
    operation: 'snapshot',
    direction: 'read',
    isFinal: true,
    value: text,
    valueTruncated: truncated,
  };
  if (sync) {
    captureEventSync(snapshotEvent);
  } else {
    captureEvent(snapshotEvent);
  }
}

/**
 * Read a key back through the typed getters, in the order a value is most likely
 * to have been stored.
 *
 * MMKV is typed: `getString` on a stored number returns undefined rather than
 * coercing, so trying each in turn identifies the type. `undefined` checks are
 * explicit because `getBoolean` legitimately returns `false` and `getNumber`
 * legitimately returns `0`. Returns undefined when no getter claims the key —
 * a buffer on v2, which has no `getBuffer`, or a key removed between the listener
 * firing and this read.
 */
function readValue(instance: MMKVLike, key: string): CapturedValue | undefined {
  // A *non-empty* string is taken as the answer; an empty one is held back until
  // every other getter has declined. A mismatched getter is supposed to return
  // undefined, but v4 reaches C++ through Nitro's marshalling and can answer `''`
  // for a key holding a number or a boolean instead. Accepting that would type the
  // key as an empty string and lose the value entirely — which is worse than the
  // ambiguity, since a genuinely empty string still ends up reported as one below.
  const string = tryRead(() => instance.getString(key));
  if (string) {
    return toCapturedValue('string', string);
  }
  const number = tryRead(() => instance.getNumber(key));
  if (number !== undefined) {
    return toCapturedValue('number', String(number));
  }
  const boolean = tryRead(() => instance.getBoolean(key));
  if (boolean !== undefined) {
    return toCapturedValue('boolean', String(boolean));
  }
  const buffer = tryRead(() => instance.getBuffer?.(key));
  if (buffer !== undefined) {
    return toCapturedValue('buffer', describeBuffer(buffer));
  }
  // Nothing else claimed it, so an empty string really was the value.
  if (string !== undefined) {
    return toCapturedValue('string', string);
  }
  return undefined;
}

/**
 * Run one typed getter, treating a throw as "not this type".
 *
 * Identifying a value's type by trying each getter in turn assumes a mismatch
 * *returns* undefined, which is what the v2/v3 JS classes do and what the library's
 * own test mock does. A v4 instance is a C++ HybridObject reached through Nitro's
 * type marshalling, and a mismatch there can surface as a thrown type error instead.
 * Since we cannot ask a key what it holds, the probe has to tolerate both answers.
 */
function tryRead<Value>(read: () => Value | undefined): Value | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * Serialize a value on its way *into* the store, where we have it in hand and its
 * JS type is the answer — no getter round-trip needed.
 */
function describeValue(
  value: boolean | string | number | ArrayBuffer
): CapturedValue {
  if (typeof value === 'string') {
    return toCapturedValue('string', value);
  }
  if (typeof value === 'number') {
    return toCapturedValue('number', String(value));
  }
  if (typeof value === 'boolean') {
    return toCapturedValue('boolean', String(value));
  }
  return toCapturedValue('buffer', describeBuffer(value));
}

/**
 * Buffers are described, not captured. The bytes are opaque to every viewer we
 * have, and a 500 KB image blob would cost the session's storage budget to render
 * as mojibake.
 */
function describeBuffer(buffer: ArrayBufferLike): string {
  return `<binary, ${buffer.byteLength} bytes>`;
}

function toCapturedValue(
  valueType: MMKVValueType,
  text: string
): CapturedValue {
  const result = truncateToBytes(text, MAX_VALUE_BYTES);
  return {
    valueType,
    value: result.text,
    valueTruncated: result.truncated,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(input: {
  instanceId: string;
  instanceName: string;
  operation: MMKVOperation;
  key?: string;
  direction: StorageDirection;
  captured?: CapturedValue;
  error?: string;
}): void {
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  const event: MMKVEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'mmkv',
    instanceId: input.instanceId,
    instanceName: input.instanceName,
    operation: input.operation,
    key: input.key,
    isFinal: false,
    valueType: input.captured?.valueType,
    direction: input.direction,
    value: input.captured?.value,
    valueTruncated: input.captured?.valueTruncated ?? false,
    error: input.error,
  };
  captureEvent(event);
}
