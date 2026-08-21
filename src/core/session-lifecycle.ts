/**
 * The session's lifecycle on disk.
 *
 * Rows are the capture layer's concern; everything around them is this
 * module's: marking the session open/closed as the app foregrounds and
 * backgrounds, flushing before a crash takes the process down, reinterpreting a
 * session left `open` by a previous launch as `crashed`, pruning old sessions,
 * and collecting rows left behind by a session that was never written.
 *
 * A function rather than a class: it is started once at init and never consulted
 * again, so the only thing a caller needs back is how to stop it.
 */

import type { SessionMeta } from './types';
import type { SessionRepository } from './database/types';
import {
  installCrashCapture,
  recordUncaughtError,
  closeSession,
  resumeSession,
} from './session';
import type { CaptureHandle } from './capture';

const DEFAULT_MAX_SESSIONS = 10;

interface AppStateLike {
  currentState: string;
  addEventListener(
    type: 'change',
    listener: (state: string) => void
  ): { remove(): void } | void;
}

export interface SessionLifecycleOptions {
  /**
   * Narrowed to the session side: this owns a session's lifecycle on disk and
   * never reads or writes an event.
   */
  sessionRepository: SessionRepository;
  capture: CaptureHandle;
  getSession: () => SessionMeta | null;
  /**
   * How many sessions to retain. The **only** retention mechanism: events
   * themselves are never capped, so pruning whole sessions is what bounds the
   * database.
   */
  maxSessions?: number;
}

/**
 * Bring the session's on-disk lifecycle up. Returns a stop function that removes
 * the listeners and drains the queue one last time.
 *
 * Idempotence is the caller's business: `init()` is already one-shot, so guarding
 * a second call here would only duplicate that.
 */
export function startSessionLifecycle({
  sessionRepository,
  capture,
  getSession,
  maxSessions = DEFAULT_MAX_SESSIONS,
}: SessionLifecycleOptions): () => Promise<void> {
  /**
   * Write the current session's metadata. Counters (`eventCount`, `lastEventAt`)
   * are the queue's to maintain and are deliberately not passed here — the save
   * keeps whatever the writer has counted, and on the call that *creates* the row
   * adopts the rows already written under its id (see the SQLite database).
   */
  const saveMeta = async (): Promise<void> => {
    const session = getSession();
    if (!session) return;
    try {
      await sessionRepository.save(session);
    } catch {
      // Ignore; a missing meta only costs crash-recovery for this session.
    }
  };

  const flushAndSaveMeta = async (): Promise<void> => {
    await capture.flush();
    await saveMeta();
  };

  /**
   * Reinterpret any previously-persisted session still marked `open` as
   * `crashed`: a session left open means a prior launch died before its graceful
   * teardown could record `closed`/`crashed`. Runs once at startup, before the
   * current session's meta is written (so the just-started session — not yet in
   * the table — is never touched).
   */
  const reconcileStaleSessions = async (): Promise<void> => {
    try {
      const currentId = getSession()?.id;
      const sessions = await sessionRepository.list();
      for (const meta of sessions) {
        // Never crash the live session — it may be a prior `open` session we've
        // just adopted across a reload (see the entry point's resume path).
        if (meta.status === 'open' && meta.id !== currentId) {
          await sessionRepository.save({ ...meta, status: 'crashed' });
        }
      }
    } catch {
      // Best-effort; a failed reconcile only mislabels a crashed session.
    }
  };

  const evictOldSessions = async (): Promise<void> => {
    try {
      const sessions = await sessionRepository.list();
      const surplus = sessions.slice(maxSessions);
      if (surplus.length === 0) return;
      // One bulk delete, so the prune can't race itself into a half-applied state.
      await sessionRepository.deleteMany(surplus.map((session) => session.id));
    } catch {
      // Eviction is best-effort.
    }
  };

  /**
   * Collect captured rows that belong to no session in the table.
   *
   * Retention works by pruning whole sessions, which deletes their rows by id —
   * so a row whose session was never written is not merely invisible, it is
   * permanent. They come from the window before a session's first save: the
   * warm-reload resume re-keys the ones it knows about, and this is the backstop
   * for the rest (a resume whose re-key failed, a recovered crash filed under a
   * session that was pruned launches ago).
   *
   * Runs after {@link saveMeta}, and excludes the live session regardless: its
   * rows legitimately precede its own metadata write, and a save that failed
   * must not turn into a delete.
   */
  const sweepOrphanedEvents = async (): Promise<void> => {
    try {
      await sessionRepository.deleteOrphanedEvents(getSession()?.id ?? '');
    } catch {
      // Best-effort: what is left costs disk, and nothing else.
    }
  };

  const observeAppState = (): (() => void) => {
    const appState = loadAppState();
    if (!appState) return () => {};

    const listener = (state: string): void => {
      if (state === 'background') {
        // Graceful pause: mark the session closed so a normal background/exit
        // isn't mistaken for a crash next launch. Only a session that dies while
        // foregrounded (never backgrounded) stays 'open' and is reconciled to
        // crashed — the closest signal to a real crash we have without native
        // crash handling.
        closeSession();
        void flushAndSaveMeta();
      } else if (state === 'active') {
        // Back to the foreground: reopen so a later foreground crash is detected.
        resumeSession();
        void flushAndSaveMeta();
      } else {
        // 'inactive' is transient (incoming call, app-switcher peek); just persist
        // pending rows without restating the session's lifecycle.
        void capture.flush();
      }
    };

    const subscription = appState.addEventListener('change', listener);
    return () => {
      subscription?.remove();
    };
  };

  void reconcileStaleSessions()
    .then(saveMeta)
    .then(evictOldSessions)
    .then(sweepOrphanedEvents);

  const teardowns = [
    observeAppState(),
    installCrashCapture((error, isFatal) => {
      // The recording *is* the flush: it writes synchronously (draining the queue
      // with it), because RN stops the app right after this returns in a release
      // build and an async flush would never get a turn. The async flush is the
      // fallback for when the sync write can't run — the database not open yet,
      // or persistence unavailable — and costs nothing when it already did, since
      // `flush()` returns immediately on an empty queue.
      if (!recordUncaughtError(error, isFatal)) {
        void capture.flush();
      }
    }),
  ];

  return async () => {
    for (const teardown of teardowns) {
      try {
        teardown();
      } catch {
        // Best-effort teardown.
      }
    }
    await capture.flush();
  };
}

function loadAppState(): AppStateLike | null {
  try {
    const reactNative = require('react-native') as { AppState?: AppStateLike };
    return reactNative.AppState ?? null;
  } catch {
    return null;
  }
}
