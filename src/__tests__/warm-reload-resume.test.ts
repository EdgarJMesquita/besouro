/**
 * The warm-reload session-resume gate in the entry point.
 *
 * A reload that keeps the process alive (Metro in dev, an in-place OTA relaunch
 * in production) leaves the previous session `open` on disk. Adopting it keeps
 * one continuous session; *not* adopting it hands a live session to the
 * lifecycle's reconcile, which relabels it `crashed`. So every case here is
 * ultimately about whether a reload is reported to the developer as a crash.
 *
 * The gate used to also require `__DEV__`, which made a production OTA reload
 * invent a crash that never happened — hence the explicit release-build case.
 *
 * These drive the private `connectDatabase()` rather than `init()`: it is the
 * unit that owns the gate, and `init()` would additionally register the drawer's
 * RN surface, which this node-environment suite cannot mount.
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';
import type { SessionMeta } from '../core/types';

const NATIVE_PATH = '../native/NativeBesouro';
const DATABASE_PATH = '../core/database';
const CRASH_INGEST_PATH = '../core/crash-ingest';
const LIFECYCLE_PATH = '../core/session-lifecycle';

const PREVIOUS: SessionMeta = {
  id: 'previous-session',
  startedAt: 1754500000000,
  status: 'open',
};

interface LoadOptions {
  /** What the native module reports; `null` stands in for "not linked". */
  warmReload: boolean | null;
  /** Rows `sessions.list()` resolves with, or an error it rejects with. */
  sessions?: SessionMeta[];
  listError?: Error;
}

function load({ warmReload, sessions = [], listError }: LoadOptions) {
  jest.resetModules();

  const setCrashContext = jest.fn();
  jest.doMock(NATIVE_PATH, () => ({
    __esModule: true,
    default:
      warmReload === null
        ? null
        : { isWarmReload: () => warmReload, setCrashContext },
  }));

  const listMock = jest.fn(async () => {
    if (listError) throw listError;
    return sessions;
  });
  const saveMock = jest.fn(async () => {});
  const reassignMock = jest.fn(async (_from: string, _to: string) => {});
  jest.doMock(DATABASE_PATH, () => ({
    __esModule: true,
    // Truthy, so the entry point takes the "backend available" branch.
    createNativeSqlConnection: () => ({}),
    openDatabase: () => ({
      ready: async () => {},
      events: {},
      sessions: {
        list: listMock,
        save: saveMock,
        reassignEvents: reassignMock,
      },
    }),
  }));

  // Out of scope and both reach for native state: the crash spool and the
  // AppState/prune lifecycle.
  jest.doMock(CRASH_INGEST_PATH, () => ({
    __esModule: true,
    ingestPendingCrashes: async () => {},
  }));
  jest.doMock(LIFECYCLE_PATH, () => ({
    __esModule: true,
    startSessionLifecycle: () => async () => {},
  }));

  // Required after the mocks so both see the same fresh module registry — the
  // session module here must be the one the entry point mutates.
  const session =
    require('../core/session') as typeof import('../core/session');
  // The controller, not `../index`: the public export is a facade over it (§4), so
  // it carries neither this private method nor anything else worth reaching for.
  const { controller } =
    require('../core/controller') as typeof import('../core/controller');

  // `init()` starts the session before connecting the database; mirror that.
  session.startSession();
  const freshId = session.getCurrentSession()?.id;

  const connect = (
    controller as unknown as { connectDatabase(): Promise<void> }
  ).connectDatabase.bind(controller);

  return { connect, session, freshId, setCrashContext, listMock, reassignMock };
}

describe('warm-reload session resume', () => {
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
  });

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });

  it('adopts the previous open session on a warm reload', async () => {
    const { connect, session } = load({
      warmReload: true,
      sessions: [PREVIOUS],
    });

    await connect();

    // Same id, so the rows already written under it are still this session's.
    expect(session.getCurrentSession()).toMatchObject({
      id: 'previous-session',
      startedAt: PREVIOUS.startedAt,
      status: 'open',
    });
  });

  it('adopts on a warm reload in a release build, where OTA reloads happen', async () => {
    // The regression this guards: gating on `__DEV__` as well as the native
    // signal meant `Updates.reloadAsync()` / `HotUpdater.reload()` left the
    // pre-reload session `open`, and reconcile then called it `crashed`.
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;

    const { connect, session } = load({
      warmReload: true,
      sessions: [PREVIOUS],
    });

    await connect();

    expect(session.getCurrentSession()?.id).toBe('previous-session');
  });

  it('keeps the fresh session on a cold start, leaving the stale one to reconcile', async () => {
    // A native crash kills the process, so its relaunch reads as cold. The
    // still-`open` session on disk is a genuine crash and must not be adopted.
    const { connect, session, freshId } = load({
      warmReload: false,
      sessions: [PREVIOUS],
    });

    await connect();

    expect(session.getCurrentSession()?.id).toBe(freshId);
    expect(session.getCurrentSession()?.id).not.toBe('previous-session');
  });

  it('does not adopt a session that was closed cleanly', async () => {
    const { connect, session, freshId } = load({
      warmReload: true,
      sessions: [{ ...PREVIOUS, status: 'closed', endedAt: 1754500001000 }],
    });

    await connect();

    expect(session.getCurrentSession()?.id).toBe(freshId);
  });

  it('adopts the most recent open session when several are on disk', async () => {
    // sessions.list() returns newest first; a run of stale sessions must not
    // resurrect the oldest one.
    const { connect, session } = load({
      warmReload: true,
      sessions: [
        { ...PREVIOUS, id: 'newest', startedAt: 1754500002000 },
        { ...PREVIOUS, id: 'oldest', startedAt: 1754500000000 },
      ],
    });

    await connect();

    expect(session.getCurrentSession()?.id).toBe('newest');
  });

  it('keeps the fresh session when the session read fails', async () => {
    const { connect, session, freshId } = load({
      warmReload: true,
      sessions: [PREVIOUS],
      listError: new Error('database is locked'),
    });

    await expect(connect()).resolves.toBeUndefined();
    expect(session.getCurrentSession()?.id).toBe(freshId);
  });

  it('never reads sessions when the native module is absent', async () => {
    // No native module means no warm/cold signal at all, so resuming would be a
    // guess. Expo Go and the web take this path.
    const { connect, session, freshId, listMock } = load({
      warmReload: null,
      sessions: [PREVIOUS],
    });

    await connect();

    expect(listMock).not.toHaveBeenCalled();
    expect(session.getCurrentSession()?.id).toBe(freshId);
  });

  it('moves the rows captured before the adopt onto the adopted session', async () => {
    // Interception is installed in `init()`, so this reload's startup rows —
    // `Running "main"` and whatever else the app logs first — were already
    // written under the id the adopt discards. Left there they belong to no
    // session at all: unreadable, and outside what retention can ever prune.
    const { connect, freshId, reassignMock } = load({
      warmReload: true,
      sessions: [PREVIOUS],
    });

    await connect();

    expect(reassignMock).toHaveBeenCalledWith(freshId, 'previous-session');
  });

  it('moves nothing on a cold start, where the fresh session is kept', async () => {
    const { connect, reassignMock } = load({
      warmReload: false,
      sessions: [PREVIOUS],
    });

    await connect();

    expect(reassignMock).not.toHaveBeenCalled();
  });

  it('moves nothing when there is no session to adopt', async () => {
    const { connect, reassignMock } = load({ warmReload: true, sessions: [] });

    await connect();

    expect(reassignMock).not.toHaveBeenCalled();
  });

  it('arms native crash capture with the adopted id, not the discarded one', async () => {
    // Ordering guard: the resume has to settle before the id is handed over, or
    // a crash after the reload would be filed under a session with no rows.
    const { connect, setCrashContext, freshId } = load({
      warmReload: true,
      sessions: [PREVIOUS],
    });

    await connect();

    expect(setCrashContext).toHaveBeenCalledWith('previous-session');
    expect(setCrashContext).not.toHaveBeenCalledWith(freshId);
  });
});
