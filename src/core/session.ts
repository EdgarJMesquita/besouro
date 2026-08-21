/**
 * Session lifecycle + JS-crash capture.
 *
 * Each app launch is a session. On graceful teardown it is marked `closed`; a
 * session still `open` on the next launch is surfaced as possibly `crashed`. The
 * global error handler is wrapped so the event writer can flush before RN's
 * own handler runs.
 */

import { captureEventSync, createEventId } from './capture';
import { formatArguments, errorStack } from './serialize';
import { truncateToBytes } from './truncate';
import type { ConsoleEvent, Inspector, SessionMeta } from './types';
import { sessionTabs } from './session-tabs';

interface ErrorUtilsLike {
  getGlobalHandler?: () =>
    ((error: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (
    handler: (error: unknown, isFatal?: boolean) => void
  ) => void;
}

let currentSession: SessionMeta | null = null;

/**
 * Begin a session, recording which inspectors are running for it.
 *
 * The set is stored with the session because it is the only thing that can say
 * what its rows are *about*: switch an inspector off and relaunch, and the live
 * set no longer explains the events already on disk (see `core/session-tabs.ts`).
 * Defaulted so a test that only needs a session id can call this bare.
 */
export function startSession(
  inspectors: readonly Inspector[] = [],
  appVersion?: string
): SessionMeta {
  currentSession = {
    id: createEventId(),
    startedAt: Date.now(),
    status: 'open',
    appVersion,
    inspectors: [...inspectors],
  };
  return currentSession;
}

export function getCurrentSession(): SessionMeta | null {
  return currentSession;
}

export function closeSession(): void {
  if (currentSession) {
    currentSession.status = 'closed';
    currentSession.endedAt = Date.now();
  }
}

/**
 * Continue a previously persisted session as the current one, reusing its id and
 * start time. Survives a full JS reload — Metro's in dev, an in-place OTA
 * relaunch in production: the pre-reload session is still `open` on disk, so
 * adopting it (instead of minting a new id) keeps one continuous session: its
 * rows are already in the database under that id. Forced back to `open` since
 * it's live again.
 *
 * The recorded inspector set is *unioned* rather than taken from either side: a
 * reload is exactly when the config can change, and the rows captured before it
 * must not lose the tab that shows them.
 */
export function adoptSession(meta: SessionMeta): SessionMeta {
  const live = currentSession?.inspectors ?? [];
  currentSession = {
    ...meta,
    status: 'open',
    endedAt: undefined,
    inspectors: sessionTabs(live, meta.inspectors),
  };
  return currentSession;
}

/**
 * Re-open the session after it was closed on backgrounding. Backgrounding marks
 * the session `closed` (a graceful pause, so a normal exit isn't read as a crash);
 * returning to the foreground reopens it so a later foreground crash is still
 * detected as one. Clears `endedAt` — the session is live again.
 */
export function resumeSession(): void {
  if (currentSession) {
    currentSession.status = 'open';
    currentSession.endedAt = undefined;
  }
}

/** Ceiling on a recorded error message and its stack — 50 KB, since a trace cut
 * short is usually cut above the frame that explains the crash. */
const MAX_MESSAGE_BYTES = 50_000;

/**
 * Record a global-handler error as a `console` event at level `uncaught`.
 *
 * Written **synchronously**, unlike every other capture in the library. A fatal
 * error hands control to RN's exception manager immediately after this returns,
 * and in a release build that stops the app — so an async flush never gets a turn
 * and the row is lost, which is exactly the row the developer needs. The blocking
 * write also drains the logs already queued behind it, so the run-up to the crash
 * survives with it. Returns whether it landed; the caller falls back to an async
 * flush when it didn't (the error may be non-fatal, in which case the app lives).
 *
 * RN's own handler re-logs the error through `console.error` right after this
 * (`ExceptionsManager.reportException`, deliberately, so monkey-patched consoles
 * see it), so the same error also appears as a plain `error` row. That pair is
 * intentional: the `uncaught` row carries the stack and `fatal`, the `error` row is
 * whatever RN chose to print.
 */
export function recordUncaughtError(error: unknown, isFatal: boolean): boolean {
  const session = currentSession;
  if (!session) {
    return false;
  }

  const { text, truncated } = truncateToBytes(
    formatArguments([error]),
    MAX_MESSAGE_BYTES
  );

  const event: ConsoleEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'console',
    level: 'uncaught',
    message: text,
    messageTruncated: truncated,
    stack: errorStack(error),
    fatal: isFatal,
  };
  return captureEventSync(event);
}

/**
 * Wrap RN's global error handler so `onCrash` runs (e.g. to flush the write queue)
 * before the previous handler. Returns a restore function; no-ops when
 * `ErrorUtils` is unavailable.
 */
export function installCrashCapture(
  onCrash: (error: unknown, isFatal: boolean) => void
): () => void {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const previous = errorUtils?.getGlobalHandler?.();
  if (!errorUtils?.setGlobalHandler) {
    return () => {};
  }

  const handler = (error: unknown, isFatal?: boolean): void => {
    try {
      onCrash(error, isFatal ?? false);
    } catch {
      // Never let crash-capture bookkeeping mask the original error.
    }
    previous?.(error, isFatal);
  };

  errorUtils.setGlobalHandler(handler);

  return () => {
    if (errorUtils.getGlobalHandler?.() === handler && previous) {
      errorUtils.setGlobalHandler?.(previous);
    }
  };
}
