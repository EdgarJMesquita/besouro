/**
 * The value a watched store is holding *right now*, for the one pane that has no row
 * to read it from.
 *
 * The Zustand and Jotai tabs render state out of the newest row, because every row
 * those inspectors write carries the whole state — the row is the state, which is
 * what lets one pane serve a live session and an archived one with no second copy to
 * drift (see `zustand/store/stores.ts`). It leaves exactly one gap: **no rows at
 * all**, while the store is plainly holding something. Clearing the log is how a
 * reader gets there, and a store whose initial capture threw inside `safeCapture` is
 * the other way.
 *
 * Nothing has happened to the store in either case, so the pane asks it directly.
 *
 * **A handle, not a copy.** What is registered here is a closure over the consumer's
 * own store; it is called when a pane renders and nothing is kept between calls. A
 * serialized copy parked beside the rows is precisely the drift the registries were
 * emptied to avoid — this cannot disagree with the store, because it *is* the store.
 *
 * **Live sessions only**, enforced at the call site: an archived session's rows
 * describe a run that has ended, and answering "current state" from a store this
 * launch happens to have is how a pane comes to describe the wrong run entirely.
 */

import { safeStringify } from './serialize';
import { truncateToBytes } from './truncate';

/**
 * The per-read ceiling. Matches `MAX_STATE_BYTES` / `MAX_VALUE_BYTES` in the two
 * interceptors, so a state reaching this pane through the store and the same state
 * reaching it through a row are clipped at the same place.
 */
const MAX_STATE_BYTES = 500_000;

/** A live read, serialized the way the row carrying it would have been. */
export interface LiveState {
  raw: string;
  truncated: boolean;
}

const readers = new Map<string, () => unknown>();

/**
 * Offer a way to read one store's current value, keyed by the id its rows carry.
 * Returns the withdrawal, which each attach runs on detach — a store the inspector
 * has stopped watching must not be presented as live.
 */
export function registerLiveState(id: string, read: () => unknown): () => void {
  readers.set(id, read);
  return () => {
    if (readers.get(id) === read) {
      readers.delete(id);
    }
  };
}

/**
 * Read and serialize what the store behind `id` holds, or null when nothing is
 * registered under it, the read throws, or there is no value to show — each of which
 * leaves the pane saying "no value", exactly as an absent row does.
 */
export function readLiveState(id: string): LiveState | null {
  const read = readers.get(id);
  if (!read) {
    return null;
  }
  try {
    const { text, truncated } = truncateToBytes(
      safeStringify(read()),
      MAX_STATE_BYTES
    );
    return text ? { raw: text, truncated } : null;
  } catch {
    // A getter that throws is the case the store registry exists for: the store
    // stays listed, and this pane says it has nothing rather than taking the tab
    // down with it.
    return null;
  }
}

/** Forget every registered store. Tests only. */
export function clearLiveState(): void {
  readers.clear();
}
