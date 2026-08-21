/**
 * In-memory, keyed store for transient UI state that should survive the drawer
 * being closed and reopened but *not* an app relaunch — e.g. which detail a given
 * inspector had drilled into. The native bubble tears down the whole surface
 * on close, which would otherwise reset each tab's local `useState`; a
 * module-level store (the JS context outlives the surface) preserves it.
 *
 * "Ephemeral" is the lifetime, not the subject: this is unrelated to a recording
 * session (`session.ts`, `SessionMeta`) — it just lives and dies with the JS
 * context.
 *
 * This is the memory-only sibling of `persisted-state.ts` (which persists to disk),
 * and the generic, keyed generalization of `active-inspector-store.ts`. Nothing is
 * written to disk, so restored values are gone after a reload — which is what we
 * want for selections that point at ephemeral, per-session events.
 */

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Dispatch, SetStateAction } from 'react';

const state = new Map<string, unknown>();
const listeners = new Set<() => void>();

export function getEphemeral<T>(key: string, fallback: T): T {
  return state.has(key) ? (state.get(key) as T) : fallback;
}

export function setEphemeral<T>(key: string, value: T): void {
  if (state.has(key) && state.get(key) === value) return;
  state.set(key, value);
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeEphemeral(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `useState`-shaped hook whose value is kept in a module-level store, so it
 * survives the surface being torn down and rebuilt. The store keeps the
 * exact reference passed to the setter, so object values (a selected directory
 * entry, a navigation path stack) stay referentially stable across a remount.
 *
 * A full `useState` drop-in: the setter accepts either a value or an updater
 * function. The initial `defaultValue` is captured once (like `useState`) so the
 * snapshot stays referentially stable even when the default is an object/array —
 * pass a literal freely.
 */
export function useEphemeralState<T>(
  key: string,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] {
  // Capture the default once so getSnapshot returns a stable reference for an
  // unset key — a fresh `[]`/`{}` each render would loop useSyncExternalStore.
  const defaultRef = useRef(defaultValue);
  const value = useSyncExternalStore(subscribeEphemeral, () =>
    getEphemeral(key, defaultRef.current)
  );
  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const resolved =
        typeof next === 'function'
          ? (next as (prev: T) => T)(getEphemeral(key, defaultRef.current))
          : next;
      setEphemeral(key, resolved);
    },
    [key]
  );
  return [value, setValue];
}
