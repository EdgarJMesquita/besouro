/**
 * Viewing-session context — lets the reused drawer tab UI read a *past* session's
 * events instead of the live one's.
 *
 * A session is identified, not loaded: the context carries only its
 * {@link SessionMeta}, and the tabs page its rows out of the events exactly as
 * they do for the live session. Opening a month-old session with 50k events is
 * therefore as cheap as opening the current one.
 *
 * The live drawer renders the tabs with no provider (the default is "live"); the
 * stacked session panel wraps the same tabs in a {@link ViewingSessionProvider}.
 * State ownership stays with the drawer that opened the overlay, so closing it
 * returns to live with no extra teardown.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type {
  BesouroEvent,
  InspectorKind,
  SessionMeta,
} from '../../core/types';
import { usePagedEvents, type PagedEvents } from '../hooks/paged-events';
import { getCurrentSession } from '../../core/session';
import { useEventRepository } from './database';

/** A past session being inspected read-only. */
export interface ViewingSession {
  meta: SessionMeta;
}

const ViewingSessionContext = createContext<ViewingSession | null>(null);

export function ViewingSessionProvider({
  session,
  children,
}: {
  session: ViewingSession;
  children: ReactNode;
}): ReactNode {
  return (
    <ViewingSessionContext.Provider value={session}>
      {children}
    </ViewingSessionContext.Provider>
  );
}

/** The past session the current subtree is viewing, or null when live. */
export function useViewingSession(): ViewingSession | null {
  return useContext(ViewingSessionContext);
}

export interface SessionEventsOptions {
  search?: string;
  /** Restrict to one socket connection / zustand store. */
  group?: string;
  /** Equality filter on one of the kind's columns, by event field name. */
  where?: { field: string; value: string };
}

/**
 * Paged events for an inspector tab, from whichever session the surrounding
 * subtree is showing — the live one by default, or the viewed one inside a
 * session overlay.
 *
 * Returns the same shape in both cases. The only difference is that a past
 * session is frozen: its rows can't change, so capture never triggers a re-query
 * for it.
 */
export function useSessionEvents(
  kind: InspectorKind,
  options: SessionEventsOptions = {}
): PagedEvents {
  const viewing = useViewingSession();
  const eventRepository = useEventRepository();
  const liveSessionId = getCurrentSession()?.id ?? null;

  return usePagedEvents({
    eventRepository,
    sessionId: viewing ? viewing.meta.id : liveSessionId,
    kind,
    search: options.search,
    group: options.group,
    where: options.where,
    live: !viewing,
  });
}

export type { BesouroEvent };
