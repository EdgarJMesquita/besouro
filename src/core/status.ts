/**
 * Per-inspector runtime status, surfaced in the drawer so failures are visible
 * rather than silent: `active`, `not-installed` (missing optional peer), or
 * `degraded` (install/capture failure).
 */

import { useSyncExternalStore } from 'react';
import type { Inspector, InspectorStatus } from './types';

const statuses = new Map<Inspector, InspectorStatus>();
const listeners = new Set<() => void>();

export function setInspectorStatus(
  inspector: Inspector,
  status: InspectorStatus
): void {
  if (statuses.get(inspector) === status) {
    return;
  }
  statuses.set(inspector, status);
  for (const listener of listeners) {
    listener();
  }
}

export function getInspectorStatus(inspector: Inspector): InspectorStatus {
  return statuses.get(inspector) ?? 'not-installed';
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to a single inspector's status. */
export function useInspectorStatus(inspector: Inspector): InspectorStatus {
  return useSyncExternalStore(subscribe, () => getInspectorStatus(inspector));
}
