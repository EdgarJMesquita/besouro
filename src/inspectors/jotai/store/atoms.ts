/**
 * Registry of *what the inspector knows about* each watched Jotai atom — the name the
 * consumer declared it under, and whether it is still subscribed.
 *
 * Deliberately not a mirror of the atom's value. Values live in the database: every
 * `jotai` row carries the whole serialized value, so the newest row per atom *is* the
 * current value, and the tab reads that same source in a live session and a past one.
 * The registry used to hold the identical string the row already carried, and the tab
 * picked between them by session — one fact, two copies, free to drift.
 *
 * What is left is inspector metadata: facts about the *subscription*, which no row
 * should have to carry and which stop being true the moment the process ends. Nothing
 * here is persisted, for the same reason.
 *
 * The sibling of the Zustand registry (`inspectors/zustand/store/stores.ts`), which
 * follows the MMKV one (`inspectors/mmkv/store/instances.ts`).
 */

import { useSyncExternalStore } from 'react';

export interface JotaiAtomInfo {
  atomId: string;
  /** The key this atom appeared under in `jotai`. */
  atomName: string;
  /**
   * When the inspector subscribed. Stands in for a row timestamp in the one case an
   * atom has no rows — otherwise the list would show the epoch (1969) for it.
   */
  registeredAt: number;
  /** False once the inspector's detach ran; the atom stays listed until cleared. */
  attached: boolean;
}

const infoById = new Map<string, JotaiAtomInfo>();
const listeners = new Set<() => void>();
let snapshot: JotaiAtomInfo[] = [];

function emit(): void {
  snapshot = [...infoById.values()];
  for (const listener of listeners) {
    listener();
  }
}

/** Record an atom the inspector has subscribed to. */
export function registerJotaiAtom(
  info: Omit<JotaiAtomInfo, 'attached' | 'registeredAt'>
): void {
  infoById.set(info.atomId, {
    ...info,
    registeredAt: Date.now(),
    attached: true,
  });
  emit();
}

/** Mark an atom detached, keeping what we knew about it. */
export function markJotaiAtomDetached(atomId: string): void {
  const existing = infoById.get(atomId);
  if (!existing) {
    return;
  }
  infoById.set(atomId, { ...existing, attached: false });
  emit();
}

/**
 * Forget every atom.
 *
 * Called by tests. Detach does *not* call it — it marks the atom detached and leaves
 * it listed, which is the whole point of `attached`.
 */
export function clearJotaiAtoms(): void {
  infoById.clear();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): JotaiAtomInfo[] {
  return snapshot;
}

/** What the inspector knows about the watched atoms, outside React. */
export function getJotaiAtoms(): JotaiAtomInfo[] {
  return snapshot;
}

/** Subscribe a component to the watched atoms. */
export function useJotaiAtoms(): JotaiAtomInfo[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
