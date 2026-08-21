/**
 * Disk-backed, keyed config store for small UI preferences that should survive a
 * full app relaunch — e.g. per-inspector "view mode" toggles (network URL mode,
 * file-system list/grid). It mirrors the mechanism in `settings-store.ts` (persist
 * a single JSON file via the native module, hydrate once at install, expose via
 * `useSyncExternalStore`) but keeps a generic string-keyed map instead of a fixed
 * struct, so any inspector can stash a value without extending a shared type.
 *
 * All keyed values share one file, so hydration and writes stay cheap regardless
 * of how many keys exist.
 */

import { useCallback, useSyncExternalStore } from 'react';
import NativeBesouro from '../native/NativeBesouro';

const CONFIG_FILE = 'rn-inapp-devtools_config.json';

let config: Record<string, unknown> = {};
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getConfig<T>(key: string, fallback: T): T {
  return key in config ? (config[key] as T) : fallback;
}

export function setConfig<T>(key: string, value: T): void {
  if (config[key] === value) return;
  config = { ...config, [key]: value };
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
    getConfig(key, defaultValue)
  );
  const setValue = useCallback((next: T) => setConfig(key, next), [key]);
  return [value, setValue];
}

// ── Native persistence ───────────────────────────────────────────────────────

/**
 * Load the persisted config file and merge it over the in-memory map, notifying
 * subscribers so a live UI re-reads. No-ops when the native module is absent
 * (tests/web) or the file is missing/corrupt — callers keep their defaults.
 */
export async function hydrateConfig(): Promise<void> {
  if (!NativeBesouro) return;
  try {
    const raw = await NativeBesouro.readFile(CONFIG_FILE);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    config = { ...config, ...parsed };
    notify();
  } catch {
    // Corrupt/missing file — keep whatever is already in memory.
  }
}

async function persist(): Promise<void> {
  if (!NativeBesouro) return;
  try {
    await NativeBesouro.writeFile(CONFIG_FILE, JSON.stringify(config));
  } catch {
    // Best-effort — a failed write just means the choice isn't remembered.
  }
}
