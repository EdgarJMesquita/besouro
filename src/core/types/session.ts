/**
 * What a session *is* — the run of the app a captured event belongs to.
 *
 * Domain model only. How sessions are stored, queried and deleted is the storage
 * layer's business and lives with it, in `core/database/types.ts`.
 */

import type { Inspector } from './base';

export type SessionStatus = 'open' | 'closed' | 'crashed';

export interface SessionMeta {
  id: string;
  startedAt: number;
  endedAt?: number;
  /**
   * Timestamp of the newest captured event in the session, maintained by the
   * writer as rows land. Lets the session-history list and header label show a
   * "last activity" date without touching the event tables. Absent for a session
   * that never captured an event.
   */
  lastEventAt?: number;
  /**
   * Number of events in the session, maintained by the writer alongside
   * {@link SessionMeta.lastEventAt} — a stored counter rather than a `COUNT` over
   * seven tables. Absent for sessions persisted before this was recorded — render
   * it as unknown rather than zero.
   */
  eventCount?: number;
  appVersion?: string;
  /**
   * The inspectors that were running while this session recorded — what its rows
   * can be about, which is not necessarily what is enabled now. Absent for
   * sessions persisted before this was recorded; read it as unknown rather than
   * none (see `core/session-tabs.ts`).
   */
  inspectors?: Inspector[];
  status: SessionStatus;
}
