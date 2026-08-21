/**
 * Per-connection / per-store aggregates for the tabs that list groups before
 * listing rows: WebSocket and Socket.IO connections, and Zustand stores.
 *
 * These lists are the reason `groups()` exists. Deriving them by grouping
 * loaded events in JS would mean holding every frame of every connection just to
 * render a handful of rows — and a chatty socket produces more frames than any
 * other inspector. The counts, timestamps and connection status are computed in
 * SQL instead, so the list costs one query regardless of session size.
 */

import { useEffect, useMemo, useState } from 'react';
import type { InspectorKind } from '../../core/types';
import type { EventGroup } from '../../core/database/types';
import { useEventRepository } from '../context/database';
import { useViewingSession } from '../context/viewing-session';
import { getCurrentSession } from '../../core/session';
import {
  useClearGeneration,
  useWriteRevision,
} from '../../core/inspector-revisions';

export interface EventGroups {
  groups: EventGroup[];
  loading: boolean;
}

export interface EventGroupsOptions {
  kind: InspectorKind;
  /**
   * Restricts which row each group reports as `latest` — the socket tabs pass
   * `direction = 'lifecycle'` to read connection status.
   */
  latestWhere?: { field: string; value: string };
  /** Narrows which rows are counted, so search filters the group list. */
  search?: string;
  /**
   * Which of a group's rows are a change, for `EventGroup.changeCount` — the store
   * tabs exclude their baselines with it, MMKV its snapshot row.
   */
  countWhere?: { field: string; value: string };
}

/**
 * Groups for the session the surrounding drawer is showing. Re-queries when live
 * capture reports new rows for the kind, so a new connection appears without a
 * manual refresh; a past session is frozen and queries once.
 */
export function useEventGroups({
  kind,
  latestWhere,
  search,
  countWhere,
}: EventGroupsOptions): EventGroups {
  const eventRepository = useEventRepository();
  const viewing = useViewingSession();
  const sessionId = viewing
    ? viewing.meta.id
    : (getCurrentSession()?.id ?? null);

  // Both signals, because this list has no paging window to distinguish them by:
  // new rows and deleted rows are equally reasons to re-aggregate.
  const revision = useWriteRevision(kind);
  const clearGeneration = useClearGeneration(kind);
  const liveRevision = viewing ? 0 : revision + clearGeneration;

  const [groups, setGroups] = useState<EventGroup[]>([]);
  const [loading, setLoading] = useState(false);

  // Object-valued option; rebuild it from its primitive parts so a fresh literal
  // each render doesn't re-run the query forever, and the dependency list below
  // stays honest.
  const latestField = latestWhere?.field;
  const latestValue = latestWhere?.value;
  const stableLatestWhere = useMemo(
    () =>
      latestField != null && latestValue != null
        ? { field: latestField, value: latestValue }
        : undefined,
    [latestField, latestValue]
  );
  const countField = countWhere?.field;
  const countValue = countWhere?.value;
  const stableCountWhere = useMemo(
    () =>
      countField != null && countValue != null
        ? { field: countField, value: countValue }
        : undefined,
    [countField, countValue]
  );

  useEffect(() => {
    if (!eventRepository || !sessionId) {
      setGroups([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    void eventRepository
      .groups({
        sessionId,
        kind,
        latestWhere: stableLatestWhere,
        countWhere: stableCountWhere,
        search,
      })
      .then((result) => {
        if (cancelled) return;
        // Newest activity first — the order a connection list is read in.
        setGroups([...result].sort((a, b) => b.lastAt - a.lastAt));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    eventRepository,
    sessionId,
    kind,
    stableLatestWhere,
    stableCountWhere,
    search,
    liveRevision,
  ]);

  return { groups, loading };
}
