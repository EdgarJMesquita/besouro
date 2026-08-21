/**
 * Registry of *what the inspector knows about* each attached MMKV instance — its
 * label, its storage id, and which capture path it ended up on.
 *
 * Deliberately not a mirror of the instance's contents. Contents live in the
 * database, written as `isFinal` snapshot rows by the interceptor, so the State pane
 * reads the same source in a live session and a past one and there is no second copy
 * to drift. What is left here is inspector metadata: facts about the *attachment*,
 * which no row should have to carry and which stop being true the moment the process
 * ends.
 *
 * That is also why nothing here is persisted. A past session's rows describe what its
 * instances held; they say nothing about whether this launch managed to wrap their
 * methods, and inventing an answer would be worse than the tab staying quiet.
 */

import { useSyncExternalStore } from 'react';

/**
 * How an instance's changes are being captured. `'patched'` wraps the instance's own
 * `set`/`remove`/`clearAll`, which names the operation exactly; `'listener'` is the
 * fallback for instances whose method slots refuse a wrapper (v4's C++
 * HybridObjects), where the operation is inferred and a `clearAll` arrives as a burst
 * of removes.
 */
export type MMKVCaptureMode = 'patched' | 'listener';

export interface MMKVInstanceInfo {
  instanceId: string;
  instanceName: string;
  /** The instance's own storage id, when the library version exposes one. */
  storageId?: string;
  captureMode: MMKVCaptureMode;
  /** When the inspector attached, for a list entry that has no row to date itself by. */
  registeredAt: number;
  /** False once the inspector's detach ran; the instance stays listed until cleared. */
  attached: boolean;
}

const infoById = new Map<string, MMKVInstanceInfo>();
const listeners = new Set<() => void>();
let snapshot: MMKVInstanceInfo[] = [];

function emit(): void {
  snapshot = [...infoById.values()];
  for (const listener of listeners) {
    listener();
  }
}

/** Record an instance the inspector has attached to. */
export function registerMMKVInstance(
  info: Omit<MMKVInstanceInfo, 'attached' | 'registeredAt'>
): void {
  infoById.set(info.instanceId, {
    ...info,
    registeredAt: Date.now(),
    attached: true,
  });
  emit();
}

/** Mark an instance detached, keeping what we knew about it. */
export function markMMKVInstanceDetached(instanceId: string): void {
  const existing = infoById.get(instanceId);
  if (!existing) {
    return;
  }
  infoById.set(instanceId, { ...existing, attached: false });
  emit();
}

/** Forget every instance. Used by tests and by the inspector's teardown. */
export function clearMMKVInstances(): void {
  infoById.clear();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): MMKVInstanceInfo[] {
  return snapshot;
}

/** What the inspector knows about the attached instances, outside React. */
export function getMMKVInstances(): MMKVInstanceInfo[] {
  return snapshot;
}

/** Subscribe a component to the attached instances. */
export function useMMKVInstances(): MMKVInstanceInfo[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
