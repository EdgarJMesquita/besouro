/**
 * Observable registry holding the Redux store's *current* state.
 *
 * The sibling of the persisted `redux` rows: a row is one action and the slices it
 * touched, this is the whole tree as it stands right now. Singular, because the API
 * takes one store (§6.9), so there is no map to key.
 *
 * **Why this one survives.** Zustand and Jotai used to keep registries like it and no
 * longer do: their rows carry whole states, so the newest row per store *is* the
 * current state and a second copy could only drift from it. A Redux row carries only
 * the slices one action touched. The newest row is a delta, rebuilding the tree from
 * the log is a different feature, and the `isFinal` snapshot is refreshed on a
 * throttle rather than per dispatch — so the live tree exists here or nowhere.
 *
 * Two things it does that the departed registries did not, both because Redux is
 * dispatched far more often than a Zustand store is set — by middleware, timers and
 * RTK Query polling, not only by user gestures:
 *
 * 1. **State is held by reference and serialized on read.** `safeStringify` on every
 *    dispatch would be the heaviest thing this library does to the host app. Redux
 *    state is immutable, so keeping the newest reference costs nothing, and the tab
 *    serializes once per change it actually renders.
 * 2. **The deep diff only runs when something is subscribed.** No listener means
 *    the drawer is closed or on another pane, and there is nobody to flash at.
 */

import { useSyncExternalStore } from 'react';
import { changedPaths as diffPaths } from '../utils/changed-paths';

export interface ReduxStateSnapshot {
  /** Current state, by reference — callers serialize it themselves, memoized on this. */
  state: unknown;
  /**
   * JSON paths that changed in the transition producing this snapshot, in
   * `JsonViewer` path format. Empty when nothing was subscribed at the time, since
   * the diff is skipped then.
   */
  changedPaths: readonly string[];
  /**
   * Increments on every publish. The flash keys off this as well as the paths, so
   * the same path changing twice in a row flashes twice rather than once.
   */
  revision: number;
  updatedAt: number;
  /** False once the inspector's teardown ran; the last state stays visible. */
  attached: boolean;
}

const listeners = new Set<() => void>();
let current: ReduxStateSnapshot | null = null;
let revision = 0;
/**
 * The newest revision whose change flash the Store pane has already played.
 *
 * Module-level because the flash has to outlive the pane that plays it. Switching
 * to the Actions pane unmounts the Store pane, so anything the pane remembered in
 * a ref died with it, and coming back mounted a viewer with no idea it had already
 * flashed — replaying the last change on every visit. A flash points at a change
 * the reader just watched happen; replaying it points at nothing.
 */
let playedRevision = 0;

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Publish the state produced by a transition, diffing it against the previous one
 * for the flash. Pass `prevState === undefined` for the initial publish, which has
 * nothing to compare against and so reports no changed paths.
 */
export function publishReduxState(
  nextState: unknown,
  prevState?: unknown
): void {
  revision += 1;
  current = {
    state: nextState,
    // Skipped with nobody subscribed: this is the only unbounded-ish work in the
    // dispatch path, and it exists purely to drive a visual cue.
    changedPaths:
      listeners.size > 0 && prevState !== undefined
        ? diffPaths(prevState, nextState)
        : [],
    revision,
    updatedAt: Date.now(),
    attached: true,
  };
  emit();
}

/** Mark the store detached, keeping its last state visible. */
export function markReduxStoreDetached(): void {
  if (!current || !current.attached) {
    return;
  }
  current = { ...current, attached: false };
  emit();
}

/**
 * Record that the Store pane has flashed everything up to `revision`, so a later
 * mount does not replay it. Monotonic: publishes can arrive between the render
 * that read this and the effect that writes it.
 */
export function markReduxFlashPlayed(upToRevision: number): void {
  playedRevision = Math.max(playedRevision, upToRevision);
}

/** The newest revision already flashed — read once per Store pane mount. */
export function getReduxFlashPlayed(): number {
  return playedRevision;
}

/** Drop the snapshot entirely — used when the inspector tears down. */
export function clearReduxSnapshot(): void {
  if (!current) {
    return;
  }
  current = null;
  revision = 0;
  // Revisions restart at 1, so a stale high-water mark would swallow the next
  // store's first flashes.
  playedRevision = 0;
  emit();
}

export function getReduxSnapshot(): ReduxStateSnapshot | null {
  return current;
}

export function subscribeReduxSnapshot(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the Redux store's current state. */
export function useReduxSnapshot(): ReduxStateSnapshot | null {
  return useSyncExternalStore(subscribeReduxSnapshot, getReduxSnapshot);
}
