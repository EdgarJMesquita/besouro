/**
 * Disk-backed, keyed store for small UI preferences that should survive a full app
 * relaunch — e.g. per-inspector "view mode" toggles (network URL mode, file-system
 * list/grid). It mirrors the mechanism in `settings-store.ts` (persist a single
 * JSON file via the native module, hydrate once at install, expose via
 * `useSyncExternalStore`) but keeps a generic string-keyed map instead of a fixed
 * struct, so any inspector can stash a value without extending a shared type.
 *
 * Preferences vs. settings: `settings-store.ts` holds the choices the user makes
 * in the drawer's Settings section, and its file is read by the native bubble at
 * mount — so it needs a fixed, native-visible schema. Nothing native reads this
 * file, so anything an inspector wants to remember about its own UI belongs here.
 *
 * All keyed values share one file, so hydration and writes stay cheap regardless
 * of how many keys exist.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { readJsonFile, writeJsonFile } from './json-file';

const PERSISTED_STATE_FILE = 'besouro_persisted_state.json';

let preferences: Record<string, unknown> = {};
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getPersisted<T>(key: string, fallback: T): T {
  return key in preferences ? (preferences[key] as T) : fallback;
}

export function setPersisted<T>(key: string, value: T): void {
  if (preferences[key] === value) return;
  preferences = { ...preferences, [key]: value };
  notify();
  void persist();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `useState`-shaped hook whose value is persisted to native storage and restored
 * on the next launch. Because `getSnapshot` returns the stored value (or the
 * fallback) by reference, this is intended for **primitive** values only — pass a
 * string/number/boolean, never a fresh object/array literal, or the equality
 * check driving `useSyncExternalStore` will loop.
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => void] {
  const value = useSyncExternalStore(subscribe, () =>
    getPersisted(key, defaultValue)
  );
  const setValue = useCallback((next: T) => setPersisted(key, next), [key]);
  return [value, setValue];
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Load the persisted preferences file and merge it over the in-memory map,
 * notifying subscribers so a live UI re-reads. Nothing to merge (no file, or an
 * unreadable one) leaves the map — and the subscribers — untouched.
 */
export async function hydratePersistedState(): Promise<void> {
  const parsed =
    await readJsonFile<Record<string, unknown>>(PERSISTED_STATE_FILE);
  if (!parsed) return;
  preferences = { ...preferences, ...parsed };
  notify();
}

async function persist(): Promise<void> {
  await writeJsonFile(PERSISTED_STATE_FILE, preferences);
}
