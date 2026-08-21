/**
 * Registry of *what the inspector knows about* each attached Zustand store — the
 * name the consumer declared it under, and whether it is still attached.
 *
 * Deliberately not a mirror of the store's state. State lives in the database: every
 * `zustand` row carries the whole serialized state, so the newest row per store *is*
 * the current state, and the tab reads that same source in a live session and a past
 * one. There is no second copy to drift, which is the mistake this registry used to
 * make — it held the identical string the row already carried, and the tab picked
 * between them by session.
 *
 * What is left is inspector metadata: facts about the *attachment*, which no row
 * should have to carry and which stop being true the moment the process ends. That
 * is also why nothing here is persisted. A past session's rows describe the state its
 * stores held; they say nothing about whether this launch managed to subscribe to
 * them, and inventing an answer would be worse than the tab staying quiet.
 *
 * Modeled on the MMKV registry (`inspectors/mmkv/store/instances.ts`), which settled
 * this split first.
 */

import { useSyncExternalStore } from 'react';

export interface ZustandStoreInfo {
  storeId: string;
  /** The key this store appeared under in `setZustandStores`. */
  storeName: string;
  /**
   * When the inspector subscribed. Stands in for a row timestamp in the one case a
   * store has no rows — otherwise the list would show the epoch (1969) for it.
   */
  registeredAt: number;
  /** False once the inspector's detach ran; the store stays listed until cleared. */
  attached: boolean;
}

const infoById = new Map<string, ZustandStoreInfo>();
const listeners = new Set<() => void>();
let snapshot: ZustandStoreInfo[] = [];

function emit(): void {
  snapshot = [...infoById.values()];
  for (const listener of listeners) {
    listener();
  }
}

/** Record a store the inspector has subscribed to. */
export function registerZustandStore(
  info: Omit<ZustandStoreInfo, 'attached' | 'registeredAt'>
): void {
  infoById.set(info.storeId, {
    ...info,
    registeredAt: Date.now(),
    attached: true,
  });
  emit();
}

/** Mark a store detached, keeping what we knew about it. */
export function markZustandStoreDetached(storeId: string): void {
  const existing = infoById.get(storeId);
  if (!existing) {
    return;
  }
  infoById.set(storeId, { ...existing, attached: false });
  emit();
}

/**
 * Forget every store.
 *
 * Called by tests. Detach does *not* call it — it marks the store detached and
 * leaves it listed, which is the whole point of `attached` (the same is true of the
 * MMKV and Jotai registries).
 */
export function clearZustandStores(): void {
  infoById.clear();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ZustandStoreInfo[] {
  return snapshot;
}

/** What the inspector knows about the attached stores, outside React. */
export function getZustandStores(): ZustandStoreInfo[] {
  return snapshot;
}

/** Subscribe a component to the attached stores. */
export function useZustandStores(): ZustandStoreInfo[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
