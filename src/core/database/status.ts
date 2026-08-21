/**
 * Whether the database is usable, and why not when it isn't.
 *
 * The database is not optional: captured events go straight to it (`core/capture`),
 * so if it can't be opened there is nothing to show and no second code path that
 * would make the drawer useful anyway. Rather than degrade into empty tabs that look
 * like "nothing happened", the drawer renders the failure and how to fix it.
 *
 * Three ways it goes wrong, and they need different advice:
 *
 * - `unavailable` — the native module isn't linked. Expo Go, web, a stale build.
 *   Fixed by building a dev client, not by anything at runtime.
 * - `unopened` — the module is there but `open`/migrate failed. Disk full, or a
 *   corrupt file.
 * - `write-failed` — it opened, then writes kept failing until the queue gave up
 *   ({@link MAX_CONSECUTIVE_FAILURES}). Rows captured before that are still
 *   readable, which is why this is its own state rather than a flavour of
 *   `unopened`.
 */

import { useSyncExternalStore } from 'react';

export type DatabaseStatus =
  /** Opening. Transient — the drawer usually mounts long after this resolves. */
  | { state: 'connecting' }
  | { state: 'ready' }
  | { state: 'unavailable' }
  | { state: 'unopened'; detail?: string }
  | { state: 'write-failed' };

let status: DatabaseStatus = { state: 'connecting' };
const listeners = new Set<() => void>();

export function setDatabaseStatus(next: DatabaseStatus): void {
  status = next;
  for (const listener of listeners) {
    listener();
  }
}

export function getDatabaseStatus(): DatabaseStatus {
  return status;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDatabaseStatus(): DatabaseStatus {
  return useSyncExternalStore(subscribe, getDatabaseStatus);
}

/** Whether this status is something the developer needs told about. */
export function isDatabaseFailure(current: DatabaseStatus): boolean {
  return current.state !== 'ready' && current.state !== 'connecting';
}

/**
 * Whether the drawer can show captured data. `write-failed` counts: the database
 * opened and whatever was captured before it broke is still worth reading.
 */
export function isDatabaseUsable(current: DatabaseStatus): boolean {
  return current.state === 'ready' || current.state === 'write-failed';
}
