/**
 * The startup chain the session lifecycle runs once, and the order its steps
 * depend on.
 *
 * Everything here is about the window before the current session has a row on
 * disk. Reconcile must not relabel the live session, the metadata write must
 * come before retention looks at the table, and the orphan sweep must come after
 * both — it deletes rows by "no session owns this", which is true of the live
 * session's own rows until `save` lands.
 *
 * AppState is absent in this environment (see `src/__mocks__/react-native.ts`),
 * so the listener half of the module is deliberately out of frame.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { startSessionLifecycle } from '../session-lifecycle';
import type { SessionMeta } from '../types';
import type { SessionRepository } from '../database/types';
import type { CaptureHandle } from '../capture';

const LIVE: SessionMeta = {
  id: 'live-session',
  startedAt: 1754500000000,
  status: 'open',
};

/** A session repository that records the order its methods are called in. */
function recordingSessions(stored: SessionMeta[] = []): {
  repository: SessionRepository;
  calls: string[];
  swept: string[];
} {
  const calls: string[] = [];
  const swept: string[] = [];
  return {
    calls,
    swept,
    repository: {
      list: async () => {
        calls.push('list');
        return stored;
      },
      save: async (meta) => {
        calls.push(`save:${meta.id}:${meta.status}`);
      },
      delete: async () => {
        calls.push('delete');
      },
      deleteMany: async (ids) => {
        calls.push(`deleteMany:${ids.join(',')}`);
      },
      reassignEvents: async () => {
        calls.push('reassignEvents');
      },
      deleteOrphanedEvents: async (keepSessionId) => {
        calls.push('deleteOrphanedEvents');
        swept.push(keepSessionId);
      },
    },
  };
}

function capture(): CaptureHandle {
  return {
    flush: jest.fn(async () => {}),
    drain: jest.fn(async () => {}),
    stop: jest.fn(),
  };
}

/** Let the startup chain — four awaits deep — run to completion. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

describe('the startup chain', () => {
  let sessions: ReturnType<typeof recordingSessions>;

  beforeEach(() => {
    sessions = recordingSessions();
  });

  it('sweeps orphaned rows only after the live session has been written', async () => {
    startSessionLifecycle({
      sessionRepository: sessions.repository,
      capture: capture(),
      getSession: () => LIVE,
    });
    await settle();

    const saved = sessions.calls.indexOf(`save:${LIVE.id}:open`);
    const sweep = sessions.calls.indexOf('deleteOrphanedEvents');
    expect(saved).toBeGreaterThanOrEqual(0);
    // Before the save, the live session's own rows are indistinguishable from
    // rows nobody owns — sweeping then would delete the session being recorded.
    expect(sweep).toBeGreaterThan(saved);
  });

  it('spares the live session even so, in case its metadata write failed', async () => {
    startSessionLifecycle({
      sessionRepository: sessions.repository,
      capture: capture(),
      getSession: () => LIVE,
    });
    await settle();

    expect(sessions.swept).toEqual([LIVE.id]);
  });

  it('sweeps with no session to spare when there is none', async () => {
    startSessionLifecycle({
      sessionRepository: sessions.repository,
      capture: capture(),
      getSession: () => null,
    });
    await settle();

    expect(sessions.swept).toEqual(['']);
  });

  it('reconciles a stale session to crashed, never the live one', async () => {
    const stale: SessionMeta = { ...LIVE, id: 'stale-session' };
    const withStale = recordingSessions([stale, LIVE]);

    startSessionLifecycle({
      sessionRepository: withStale.repository,
      capture: capture(),
      getSession: () => LIVE,
    });
    await settle();

    expect(withStale.calls).toContain('save:stale-session:crashed');
    expect(withStale.calls).not.toContain('save:live-session:crashed');
  });

  it('keeps sweeping when retention has nothing to prune', async () => {
    startSessionLifecycle({
      sessionRepository: sessions.repository,
      capture: capture(),
      getSession: () => LIVE,
      maxSessions: 1,
    });
    await settle();

    expect(sessions.calls).not.toContain('deleteMany:');
    expect(sessions.calls).toContain('deleteOrphanedEvents');
  });
});
