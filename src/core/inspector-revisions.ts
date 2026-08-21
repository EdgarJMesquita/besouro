/**
 * Change signals for the inspector lists.
 *
 * SQLite can't tell us when rows change — there is no change feed across the
 * bridge — so the write queue reports which kinds each flush touched and this
 * module turns that into something React can subscribe to.
 *
 * Two signals, because a list has to react to them differently:
 *
 * - **write revision** — "there are more rows": re-run the query, keep the window.
 * - **clear generation** — "rows were deleted": re-run the query *and* shrink the
 *   window back to one page, since what the user scrolled through is gone.
 *
 * Both are plain counters, and nothing ever reads them as numbers. They exist to
 * be *different* from their previous value: `useSyncExternalStore` compares
 * snapshots with `Object.is`, and both feed effect dependency lists. A monotonic
 * integer is the cheapest value that satisfies both.
 *
 * The signal fires **after the write, never at capture time**, so a list is only
 * ever told to refresh for rows that are already readable. That also means the
 * queue's flush cadence *is* the refresh cadence, so the read side needs no
 * throttle of its own.
 */

import { useSyncExternalStore } from 'react';
import type { InspectorKind } from './types';

const writeRevisions = new Map<InspectorKind, number>();
const clearGenerations = new Map<InspectorKind, number>();
const listeners = new Set<() => void>();

/**
 * One flat listener set rather than one per kind: only the active tab is mounted
 * (`InspectorTabs` renders `active` alone), so there are one or two subscribers at any
 * moment and filtering in `getSnapshot` costs less than the bookkeeping to avoid
 * waking them.
 */
function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function bump(counters: Map<InspectorKind, number>, kind: InspectorKind): void {
  counters.set(kind, (counters.get(kind) ?? 0) + 1);
}

/**
 * Report that a flush landed rows for these kinds. Wired to the queue's
 * `onFlushed`; this is what makes lists re-query.
 */
export function markWritten(kinds: Set<InspectorKind>): void {
  if (kinds.size === 0) return;
  for (const kind of kinds) {
    bump(writeRevisions, kind);
  }
  emit();
}

/**
 * Report that a kind's rows were deleted, or every kind's when called without one.
 *
 * Deleting them is the caller's job — the tab header pairs this with
 * `events.clear` — because this module has no repository reference and no
 * business owning that decision.
 */
export function markCleared(kind?: InspectorKind): void {
  const kinds = kind
    ? [kind]
    : [...clearGenerations.keys(), ...writeRevisions.keys()];
  for (const cleared of new Set(kinds)) {
    bump(clearGenerations, cleared);
  }
  emit();
}

export function getWriteRevision(kind: InspectorKind): number {
  return writeRevisions.get(kind) ?? 0;
}

export function getClearGeneration(kind: InspectorKind): number {
  return clearGenerations.get(kind) ?? 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Changes when newly written rows are available for a kind — the cue for a list to
 * re-query in place.
 */
export function useWriteRevision(kind: InspectorKind): number {
  return useSyncExternalStore(subscribe, () => getWriteRevision(kind));
}

/**
 * Changes only when a kind's rows are deleted — the cue to re-query *and* drop
 * back to a single page.
 */
export function useClearGeneration(kind: InspectorKind): number {
  return useSyncExternalStore(subscribe, () => getClearGeneration(kind));
}
