/**
 * Makes the capture database available to every surface.
 *
 * Events are paged out of SQLite rather than read from memory, so every list needs
 * it — prop-drilling through the tab bar into seven tabs and their detail views
 * would be all cost and no clarity.
 *
 * Nothing consumes the database whole. The two hooks below hand out one repository
 * each, so a call site declares which half it touches: {@link useEventRepository}
 * for the tabs and detail views, {@link useSessionRepository} for the history list.
 *
 * `useEventRepository` narrows further, to {@link EventReader} — the event
 * repository minus `commit`/`commitSync`. **This hook is what stops a UI component
 * from recording an event**: the context holds the whole database, and the return
 * type is the only thing withholding the write half. Widen it and the guarantee is
 * gone.
 *
 * Null means the database never opened (no native module, or an open that failed).
 * There is nothing to read in that case, and the drawer replaces its tabs with a
 * `DatabaseNotice` rather than showing empty ones — see `core/database/status`.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type {
  Database,
  EventRepository,
  SessionRepository,
} from '../../core/database/types';

/**
 * The read half of the event repository — everything the drawer does with events,
 * which is query, group, load one in full, count, and clear a kind. Declared here
 * rather than in `core/types` because the UI is its only consumer: the narrow view
 * belongs with whoever depends on it.
 */
export type EventReader = Omit<EventRepository, 'commit' | 'commitSync'>;

const DatabaseContext = createContext<Database | null>(null);

export function DatabaseProvider({
  database,
  children,
}: {
  database: Database | null;
  children: ReactNode;
}): ReactNode {
  return (
    <DatabaseContext.Provider value={database}>
      {children}
    </DatabaseContext.Provider>
  );
}

/** Captured events: query, group, load one in full, clear a kind. Reads only. */
export function useEventRepository(): EventReader | null {
  return useContext(DatabaseContext)?.events ?? null;
}

/** Sessions: list them, delete them. */
export function useSessionRepository(): SessionRepository | null {
  return useContext(DatabaseContext)?.sessions ?? null;
}
