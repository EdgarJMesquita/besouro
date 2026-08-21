/**
 * Remembers which inspector tab the **live** drawer was last on, so it survives the
 * drawer being closed and reopened. The native bubble flow tears down the whole
 * surface on close, which would otherwise reset local state back to the
 * first inspector on every open; a module-level store outlives the surface.
 *
 * A past-session overlay deliberately does *not* write here — it keeps its own
 * selection in local state (see `InspectorTabs`), so browsing history leaves the live
 * drawer on the tab the user left it on.
 */

import { useSyncExternalStore } from 'react';
import type { Inspector } from './types';

let activeInspector: Inspector | null = null;
const listeners = new Set<() => void>();

export function getActiveInspector(): Inspector | null {
  return activeInspector;
}

export function setActiveInspector(inspector: Inspector): void {
  if (inspector === activeInspector) return;
  activeInspector = inspector;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActiveInspector(): Inspector | null {
  return useSyncExternalStore(subscribe, getActiveInspector);
}
