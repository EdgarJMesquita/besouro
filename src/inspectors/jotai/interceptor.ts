/**
 * Jotai capture mechanism — internal.
 *
 * An atom is a *value*, not a store: it holds no state of its own, and jotai
 * exposes no way to enumerate the atoms a store has touched. So there is nothing to
 * find by inspection, and the consumer declares what to watch, keyed by the name it
 * appears under in the drawer:
 * `jotai(store, { cart: cartAtom, user: userAtom })`.
 *
 * That is a real limitation — a derived atom nobody named stays invisible — and it
 * is chosen over the alternative. `INTERNAL_getBuildingBlocksRev3` plus the
 * experimental `storeHooks` would surface every atom the store touches, labelled by
 * `debugLabel`, with no declaration at all; but they are unversioned internals that
 * a jotai minor can change without a type error, and capture would fail silently
 * (§4.1, §6.10). Declaring atoms uses `get` and `sub` and nothing else.
 *
 * Each change is recorded as a {@link JotaiEvent} carrying the whole serialized
 * value, so the newest row per atom is also the atom's current value — the tab needs
 * no second copy and reads the same source live and archived. The registry (see
 * `store/atoms`) holds only what the rows cannot: the atom's name and whether it is
 * still subscribed.
 *
 * Like the Zustand inspector, {@link installJotaiInspector} is the only way in —
 * there is deliberately no per-atom attach export, because calling one would plant a
 * static `besouro` import in feature code that ships in release, defeating
 * the consumer's single dev-only `require` (§11).
 */

import { safeCapture } from '../../core/base-interceptor';
import { isWarmReload } from '../../core/warm-reload';
import { captureEvent, createEventId, whenCapturing } from '../../core/capture';
import { getCurrentSession } from '../../core/session';
import { truncateToBytes } from '../../core/truncate';
import { safeStringify } from '../../core/serialize';
import { changedTopLevelKeys, topLevelKeys } from '../../core/state-diff';
import { registerJotaiAtom, markJotaiAtomDetached } from './store/atoms';
import { registerLiveState } from '../../core/live-state';
import { valuePreview } from './utils/preview';
import type { JotaiEvent } from '../../core/types';
import type {
  JotaiAtomLike,
  JotaiInspectorPeers,
  JotaiStoreLike,
} from './types';

/** Per-change ceiling for a serialized atom value — 500 KB, as Zustand's state. */
const MAX_VALUE_BYTES = 500_000;

export function installJotaiInspector({
  store,
  atoms,
}: JotaiInspectorPeers): () => void {
  const detachers = Object.entries(atoms).map(([name, atom]) =>
    attachAtom(store, atom, name)
  );
  return () => {
    for (const detach of detachers) {
      detach();
    }
  };
}

let attachCount = 0;

/**
 * What a live subscription records itself as, parked **on the consumer's atom** —
 * the Zustand inspector's `WATCHED`, atom-side. See that file for why this is a
 * registered symbol on the peer object rather than a module-level `WeakSet`: this
 * module is in Metro's graph when the library is consumed from source, so anything
 * module-scoped is reborn empty by Fast Refresh and guards nothing.
 *
 * It carries the previous subscription's `detach` as well as its id, so a re-install
 * replaces it rather than running alongside it, and rows keep landing under the id
 * the atom's existing rows already carry.
 */
const WATCHED = Symbol.for('besouro.jotai.watched');

interface JotaiWatch {
  atomId: string;
  detach: () => void;
}

function readWatch(target: object): JotaiWatch | undefined {
  const watch = (target as Record<symbol, unknown>)[WATCHED] as
    JotaiWatch | undefined;
  return watch && typeof watch.atomId === 'string' ? watch : undefined;
}

/** Park the watch on the atom. A frozen atom cannot carry it, which costs the
 * in-runtime re-install guard and nothing else. */
function writeWatch(target: object, watch: JotaiWatch): void {
  try {
    Object.defineProperty(target, WATCHED, {
      value: watch,
      configurable: true,
      writable: true,
    });
  } catch {
    // Frozen or sealed: capture still works, in-runtime duplicates return.
  }
}

function noop(): void {}

/**
 * Watch one atom: record its value now, then one event per subsequent change.
 *
 * Jotai's `sub` hands the listener nothing, so the new value comes from a `get` and
 * the previous one is whatever we remembered — which is why `previousValue` is kept
 * here rather than read back off the store.
 *
 * Module-private on purpose — see the note at the top of this file.
 */
function attachAtom(
  store: JotaiStoreLike,
  atom: JotaiAtomLike,
  atomName: string
): () => void {
  // A re-install rather than a new atom: retire the subscription the previous module
  // instance left behind and inherit its id, so both runs' rows stay one history.
  const previous = readWatch(atom);
  previous?.detach();

  let atomId = previous?.atomId;
  if (!atomId) {
    attachCount += 1;
    atomId = `jotai-${attachCount}`;
  }
  let previousValue: unknown;

  // Before the first capture, so an atom whose initial `get` throws is still listed
  // — as an empty atom rather than as nothing at all.
  registerJotaiAtom({ atomId, atomName });

  // Read now, because the `sub` listener below diffs against it and may fire before
  // the row below is ever written.
  safeCapture(() => {
    previousValue = store.get(atom);
  });

  // The initial row waits for capture to have somewhere to write. `init()` installs
  // inspectors and only then opens the database, so recording here directly would
  // hand the row to a sink that does not exist yet and it would be dropped — and for
  // an atom nobody touches this session, that is the only row it would ever have.
  // `whenCapturing` fires immediately once the sink is attached, and re-reads then,
  // so the row describes what capture actually started from.
  //
  // Skipped only for a re-install inside one runtime (`previous` is set, so the atom
  // object survived and holds the same value). A reload does get a row, and carries
  // `isWarmReload` to say so — see `zustand/interceptor.ts` for why the two repeats
  // need opposite answers.
  const cancelInitial =
    previous !== undefined
      ? noop
      : whenCapturing(() => {
          safeCapture(() => {
            previousValue = store.get(atom);
            record(
              atomId,
              atomName,
              previousValue,
              undefined,
              true,
              isWarmReload()
            );
          });
        });

  const unsubscribe = store.sub(atom, () => {
    safeCapture(() => {
      const nextValue = store.get(atom);
      const prior = previousValue;
      previousValue = nextValue;
      record(atomId, atomName, nextValue, prior, false);
    });
  });

  // What the Current Value pane falls back to when this atom has no rows — after the
  // log is cleared, or when the initial read above threw. Released on detach, so an
  // atom we have stopped watching stops answering. See `core/live-state`.
  const releaseLive = registerLiveState(atomId, () => store.get(atom));

  const detach = (): void => {
    cancelInitial();
    releaseLive();
    unsubscribe();
    markJotaiAtomDetached(atomId);
  };
  writeWatch(atom, { atomId, detach });
  return detach;
}

function record(
  atomId: string,
  atomName: string,
  nextValue: unknown,
  prevValue: unknown,
  isInitial: boolean,
  /** Only ever true alongside `isInitial` — see {@link JotaiEvent.isReload}. */
  isReload = false
): void {
  const serialized = safeStringify(nextValue);
  const { text, truncated } = truncateToBytes(serialized, MAX_VALUE_BYTES);
  const preview = valuePreview(serialized);

  const session = getCurrentSession();
  if (!session) {
    return;
  }

  const jotaiEvent: JotaiEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'jotai',
    atomId,
    atomName,
    isInitial,
    isReload,
    // Empty for a primitive atom — `atom(0)` has no keys, which is exactly why the
    // preview carries the value instead.
    changedKeys: isInitial
      ? topLevelKeys(nextValue)
      : changedTopLevelKeys(nextValue, prevValue),
    preview,
    value: text,
    valueTruncated: truncated,
  };
  captureEvent(jotaiEvent);
}
