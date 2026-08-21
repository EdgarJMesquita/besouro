/**
 * The React contexts every surface reads from: what the UI looks and reads
 * like ({@link ui}), and which session's events it is showing
 * ({@link viewing-session}).
 *
 * Re-exported from one place because consumers pair them — a tab component asks
 * for the theme and for its events in the same breath.
 */

export { BesouroUIProvider, useBesouroUI } from './ui';
export {
  DatabaseProvider,
  useEventRepository,
  useSessionRepository,
} from './database';
export {
  ViewingSessionProvider,
  useViewingSession,
  useSessionEvents,
  type SessionEventsOptions,
  type ViewingSession,
} from './viewing-session';
