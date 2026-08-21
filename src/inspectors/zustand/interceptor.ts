/**
 * Zustand capture mechanism — internal.
 *
 * A Zustand store is an instance you subscribe to, not a global to patch, so the
 * consumer declares the stores to watch in the config:
 * `setZustandStores({ counter: useCounterStore })`. Install subscribes to each,
 * keyed by the map's names.
 *
 * {@link installZustandInspector} is the only way in — there is deliberately no
 * per-store attach export. Attaching a store created after install would mean
 * calling this library from feature code, and that plants a static
 * `besouro` import in a module that ships in release, defeating the
 * consumer's single dev-only `require` (§11). Declaring stores in the config keeps
 * the entire graph on the dev side of that boundary.
 *
 * Each state transition (`subscribe((nextState, prevState) => …)`) is recorded as a
 * {@link ZustandEvent} carrying the whole serialized state, so the newest row per
 * store is also the store's current state — the tab needs no second copy, and reads
 * the same source live and archived. The registry (see `store/stores`) holds only
 * what the rows cannot: the store's name and whether it is still attached.
 *
 * We never import `zustand` itself: `ZustandStoreLike` is a structural subset, so a
 * store from `create(...)` (the hook, which also carries the store API) or
 * `createStore(...)` (the vanilla store) both satisfy it.
 */

import { safeCapture } from '../../core/base-interceptor';
import { isWarmReload } from '../../core/warm-reload';
import { captureEvent, createEventId, whenCapturing } from '../../core/capture';
import { getCurrentSession } from '../../core/session';
import { truncateToBytes } from '../../core/truncate';
import { safeStringify } from '../../core/serialize';
import { changedTopLevelKeys, topLevelKeys } from '../../core/state-diff';
import { registerZustandStore, markZustandStoreDetached } from './store/stores';
import { registerLiveState } from '../../core/live-state';
import type { ZustandEvent } from '../../core/types';
import type { ZustandStoreLike, ZustandStores } from './types';

/** Per-transition ceiling for a serialized store state — 500 KB. */
const MAX_STATE_BYTES = 500_000;

export function installZustandInspector(stores: ZustandStores): () => void {
  const detachers = Object.entries(stores).map(([name, zustandStore]) =>
    attachZustand(zustandStore, name)
  );
  return () => {
    for (const detach of detachers) {
      detach();
    }
  };
}

let attachCount = 0;

/**
 * What a live subscription records itself as, parked **on the consumer's store**.
 *
 * Not a module-level `WeakSet`, which is the obvious guard and does not work here.
 * When the library is consumed from source (the `besouro-source` export
 * condition), this very module is in Metro's graph: Fast Refresh re-evaluates it and
 * every module-scoped value — a `WeakSet`, `attachCount` — is reborn empty, so the
 * guard guards nothing and each reload writes another initial row. A registered
 * symbol resolves through the global registry and the mark rides on an object that
 * outlives the reload, which is the same discipline `base-interceptor`'s `PATCHED`
 * uses on a patched method.
 *
 * It carries the previous subscription's `detach` as well as its id, so a re-install
 * can *replace* it rather than guess whether it still works. Skipping the re-install
 * would keep a subscription whose capture path belongs to the retired module
 * instance; attaching alongside it would double every row. Tearing the old one down
 * and taking over its id leaves exactly one live subscription filing rows under the
 * id the store's existing rows already carry.
 */
const WATCHED = Symbol.for('besouro.zustand.watched');

interface ZustandWatch {
  storeId: string;
  detach: () => void;
}

function readWatch(target: object): ZustandWatch | undefined {
  const watch = (target as Record<symbol, unknown>)[WATCHED] as
    ZustandWatch | undefined;
  return watch && typeof watch.storeId === 'string' ? watch : undefined;
}

/**
 * Park the watch on the store. A frozen store cannot carry it, which costs the
 * reload guard and nothing else — the pre-symbol behaviour, not a new failure.
 */
function writeWatch(target: object, watch: ZustandWatch): void {
  try {
    Object.defineProperty(target, WATCHED, {
      value: watch,
      configurable: true,
      writable: true,
    });
  } catch {
    // Frozen or sealed: capture still works, duplicates across reloads return.
  }
}

/**
 * Attach the Zustand inspector to a specific store instance. Records the store's
 * initial state immediately, then one event per subsequent state change. Returns a
 * detach function that unsubscribes and marks the store detached.
 *
 * Module-private on purpose — see the note at the top of this file.
 */
function attachZustand<State>(
  zustandStore: ZustandStoreLike<State>,
  storeName: string
): () => void {
  // A reload rather than a new store: retire the subscription the previous module
  // instance left behind and inherit its id, so both runs' rows stay one history.
  const previous = readWatch(zustandStore);
  previous?.detach();

  let storeId = previous?.storeId;
  if (!storeId) {
    attachCount += 1;
    storeId = `zustand-${attachCount}`;
  }

  // Before the first capture, so a store whose initial read throws is still listed
  // — as an empty store rather than as nothing at all.
  registerZustandStore({ storeId, storeName });

  // The initial row waits for capture to have somewhere to write. `init()` installs
  // inspectors and only then opens the database, so recording here directly would
  // hand the row to a sink that does not exist yet and it would be dropped — and
  // for a store nobody touches this session, that is the only row it would ever
  // have. `whenCapturing` fires immediately once the sink is attached, and reads
  // `getState()` then, so the row describes what capture actually started from.
  //
  // Skipped for exactly one kind of repeat: **a re-install inside one runtime**,
  // when Fast Refresh re-runs the consumer's devtools module without reloading.
  // The store object survives with its current value, so `previous` is set and
  // nothing has changed to record.
  //
  // **A reload is not that case, and does get a row.** The heap is gone, so `create`
  // ran again and the store really is back at its initial state — while the session
  // it belongs to was *adopted*, leaving the pre-reload rows above it. Suppressing
  // the row here (as this once did) is what would make the pane lie: the timeline
  // would show the last pre-reload value, then a change diffed against the fresh
  // one, with the reset itself recorded nowhere. `previous` cannot see a reload —
  // nothing in JS survives one — so `isWarmReload` is what marks the row.
  const cancelInitial =
    previous !== undefined
      ? noop
      : whenCapturing(() => {
          safeCapture(() => {
            const initialState = zustandStore.getState();
            recordTransition(
              storeId,
              storeName,
              initialState,
              undefined,
              true,
              isWarmReload()
            );
          });
        });

  const unsubscribe = zustandStore.subscribe((nextState, prevState) => {
    safeCapture(() =>
      recordTransition(storeId, storeName, nextState, prevState, false)
    );
  });

  // What the Current State pane falls back to when this store has no rows — after
  // the log is cleared, or when the initial capture above threw. Released on detach,
  // so a store we have stopped watching stops answering. See `core/live-state`.
  const releaseLive = registerLiveState(storeId, () => zustandStore.getState());

  const detach = (): void => {
    cancelInitial();
    releaseLive();
    unsubscribe();
    markZustandStoreDetached(storeId);
  };
  writeWatch(zustandStore, { storeId, detach });
  return detach;
}

function noop(): void {}

function recordTransition(
  storeId: string,
  storeName: string,
  nextState: unknown,
  prevState: unknown,
  isInitial: boolean,
  /** Only ever true alongside `isInitial` — see {@link ZustandEvent.isReload}. */
  isReload = false
): void {
  const { text, truncated } = truncateToBytes(
    safeStringify(nextState),
    MAX_STATE_BYTES
  );

  const session = getCurrentSession();
  if (!session) {
    return;
  }

  const zustandEvent: ZustandEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'zustand',
    storeId,
    storeName,
    isInitial,
    isReload,
    changedKeys: isInitial
      ? topLevelKeys(nextState)
      : changedTopLevelKeys(nextState, prevState),
    state: text,
    stateTruncated: truncated,
  };
  captureEvent(zustandEvent);
}
