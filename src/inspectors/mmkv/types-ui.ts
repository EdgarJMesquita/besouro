/**
 * What the instance list renders.
 *
 * One shape from one source: the session's rows. Unlike the Zustand and Jotai list
 * items there is no `attached` flag and no live-only field, because a past session
 * and a live one are described the same way here — see `utils/instance-list.ts`.
 */

export interface MMKVInstanceListItem {
  instanceId: string;
  instanceName: string;
  /** Recorded writes and removals, excluding the instance's snapshot row. */
  changeCount: number;
  updatedAt: number;
}
