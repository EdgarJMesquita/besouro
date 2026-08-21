/**
 * Event-queue tests. The interesting cases are all about *not losing rows the drawer is
 * already showing*: events captured before the database opens, a flush that fails
 * mid-session, and the crash path where there is exactly one chance to write.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { EventQueue, MAX_CONSECUTIVE_FAILURES } from '../queue';
import { startCapture } from '../index';
import { captureEvent } from '../record';
import { openDatabase } from '../../database/sqlite-database';
import { createNodeDatabase } from '../../database/__tests__/node-database';
import type { ConsoleEvent, NetworkEvent } from '../../types';
import type { Database, EventBatch } from '../../database/types';

const SESSION = 'session-1';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function networkEvent(id: string, timestamp = 1_000): NetworkEvent {
  return {
    id,
    sessionId: SESSION,
    timestamp,
    kind: 'network',
    method: 'GET',
    url: `https://example.com/${id}`,
    requestHeaders: {},
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    phase: 'pending',
  };
}

function consoleEvent(id: string, message: string): ConsoleEvent {
  return {
    id,
    sessionId: SESSION,
    timestamp: 1_000,
    kind: 'console',
    level: 'log',
    message,
    messageTruncated: false,
  };
}

/** An database that records batches and can be made to fail on demand. */
function recordingDatabase(): {
  database: Database;
  batches: EventBatch[];
  failNext: (count: number) => void;
  /** Resolve the gate to let a held write proceed. */
  hold: () => () => void;
} {
  const batches: EventBatch[] = [];
  let failures = 0;
  let gate: Promise<void> | null = null;
  let release: (() => void) | null = null;

  const events = {
    query: async () => ({ rows: [], hasMore: false, cursor: null }),
    groups: async () => [],
    load: async () => null,
    count: async () => 0,
    clear: async () => {},
    async commit(batch: EventBatch) {
      if (gate) await gate;
      if (failures > 0) {
        failures -= 1;
        throw new Error('write failed');
      }
      // Snapshot: the queue reuses its arrays between flushes.
      batches.push({
        inserts: [...batch.inserts],
        updates: batch.updates.map((update) => ({ ...update })),
      });
    },
    commitSync(batch: EventBatch) {
      // The gate models an in-flight *async* write and has no bearing here: the
      // sync path can't await anything, which is the whole point of it.
      if (failures > 0) {
        failures -= 1;
        return false;
      }
      batches.push({
        inserts: [...batch.inserts],
        updates: batch.updates.map((update) => ({ ...update })),
      });
      return true;
    },
  };

  const database = {
    ready: async () => {},
    events,
    sessions: {
      list: async () => [],
      save: async () => {},
      delete: async () => {},
      deleteMany: async () => {},
    },
  } as unknown as Database;

  return {
    database,
    batches,
    failNext: (count) => {
      failures = count;
    },
    hold: () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release?.();
      };
    },
  };
}

describe('batching', () => {
  it('coalesces a burst into one transaction', async () => {
    const { database, batches } = recordingDatabase();
    const queue = new EventQueue({
      eventRepository: database.events,
      flushIntervalMs: 250,
    });

    queue.add(networkEvent('n1'));
    queue.add(networkEvent('n2'));
    queue.add(networkEvent('n3'));
    expect(batches).toHaveLength(0); // nothing written yet — still batching

    await queue.flush();

    expect(batches).toHaveLength(1);
    expect(batches[0]?.inserts.map((event) => event.id)).toEqual([
      'n1',
      'n2',
      'n3',
    ]);
  });

  it('flushes on the timer without an explicit call', async () => {
    const { database, batches } = recordingDatabase();
    const queue = new EventQueue({
      eventRepository: database.events,
      flushIntervalMs: 250,
    });

    queue.add(networkEvent('n1'));
    jest.advanceTimersByTime(250);
    await Promise.resolve();
    await Promise.resolve();

    expect(batches).toHaveLength(1);
  });

  it('flushes immediately once maxPending is reached', async () => {
    const { database, batches } = recordingDatabase();
    const queue = new EventQueue({
      eventRepository: database.events,
      maxPending: 3,
    });

    queue.add(networkEvent('n1'));
    queue.add(networkEvent('n2'));
    expect(batches).toHaveLength(0);
    queue.add(networkEvent('n3'));
    await Promise.resolve();
    await Promise.resolve();

    // The cap fired without waiting for the timer.
    expect(batches).toHaveLength(1);
  });

  it('merges a patch into a still-pending insert instead of emitting an update', async () => {
    const { database, batches } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    queue.add(networkEvent('n1'));
    queue.update('n1', 'network', { phase: 'success', status: 200 });
    await queue.flush();

    expect(batches[0]?.updates).toHaveLength(0);
    expect(batches[0]?.inserts[0]).toMatchObject({
      id: 'n1',
      phase: 'success',
      status: 200,
    });
  });

  it('coalesces repeated patches to the same row into one update', async () => {
    const { database, batches } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    // Row already written by an earlier flush.
    queue.add(networkEvent('n1'));
    await queue.flush();

    queue.update('n1', 'network', { status: 200 });
    queue.update('n1', 'network', { durationMs: 12 });
    queue.update('n1', 'network', { phase: 'success' });
    await queue.flush();

    expect(batches[1]?.updates).toHaveLength(1);
    expect(batches[1]?.updates[0]?.patch).toEqual({
      status: 200,
      durationMs: 12,
      phase: 'success',
    });
  });

  it('does nothing when there is nothing pending', async () => {
    const { database, batches } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });
    await queue.flush();
    expect(batches).toHaveLength(0);
  });

  it('shares an in-flight flush rather than racing a second transaction', async () => {
    const { database, batches, hold } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });
    const release = hold();

    queue.add(networkEvent('n1'));
    const first = queue.flush();
    const second = queue.flush();
    release();
    await Promise.all([first, second]);

    expect(batches).toHaveLength(1);
  });
});

describe('capture before the database is open', () => {
  it('writes events queued before ready() resolves', async () => {
    const sql = createNodeDatabase();
    let releaseOpen: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });

    // Stand in for the bridge round trip: open resolves only when we say so.
    const slowSql = {
      ...sql,
      async open() {
        await gate;
      },
    };
    const database = openDatabase(slowSql);
    const queue = new EventQueue({ eventRepository: database.events });

    // Capture happens first — exactly what init() does before persistence starts.
    queue.add(consoleEvent('c1', 'startup log'));
    queue.add(networkEvent('n1'));

    const flushed = queue.flush();
    releaseOpen!();
    await flushed;

    // Nothing was lost to the pre-open window.
    expect(await database.events.count(SESSION, 'console')).toBe(1);
    expect(await database.events.count(SESSION, 'network')).toBe(1);
    sql.close();
  });
});

describe('failure handling', () => {
  it('retries a failed flush without losing rows', async () => {
    const { database, batches, failNext } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    failNext(1);
    queue.add(networkEvent('n1'));
    await queue.flush();

    // First attempt threw; the row is still queued, not dropped.
    expect(batches).toHaveLength(0);
    expect(queue.pendingCount()).toBe(1);

    await queue.flush();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.inserts[0]?.id).toBe('n1');
  });

  it('keeps newer patches when a failed flush is requeued', async () => {
    const { database, batches, failNext } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    queue.add(networkEvent('n1'));
    await queue.flush();

    failNext(1);
    queue.update('n1', 'network', { status: 500 });
    const failing = queue.flush();
    // A newer patch arrives while the failing write is in flight.
    queue.update('n1', 'network', { status: 200, phase: 'success' });
    await failing;

    await queue.flush();
    const update = batches[1]?.updates[0];
    // The newer status wins; the older patch's other fields survive.
    expect(update?.patch).toMatchObject({ status: 200, phase: 'success' });
  });

  it('disables itself after repeated failures instead of growing forever', async () => {
    const { database, failNext } = recordingDatabase();
    const onDisabled = jest.fn();
    const queue = new EventQueue({
      eventRepository: database.events,
      onDisabled,
    });

    failNext(MAX_CONSECUTIVE_FAILURES);
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_FAILURES; attempt++) {
      queue.add(networkEvent(`n${attempt}`));
      await queue.flush();
    }

    expect(queue.isEnabled()).toBe(false);
    expect(onDisabled).toHaveBeenCalledTimes(1);
    // The queue is released — this is what bounds memory when persistence is
    // permanently broken.
    expect(queue.pendingCount()).toBe(0);

    // Further capture is accepted and dropped, never queued.
    queue.add(networkEvent('after'));
    expect(queue.pendingCount()).toBe(0);
  });

  it('resets the failure count after a success', async () => {
    const { database, failNext } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    failNext(MAX_CONSECUTIVE_FAILURES - 1);
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_FAILURES - 1; attempt++) {
      queue.add(networkEvent(`n${attempt}`));
      await queue.flush();
    }
    await queue.flush(); // succeeds, clearing the streak

    failNext(MAX_CONSECUTIVE_FAILURES - 1);
    for (let attempt = 0; attempt < MAX_CONSECUTIVE_FAILURES - 1; attempt++) {
      queue.add(networkEvent(`m${attempt}`));
      await queue.flush();
    }

    expect(queue.isEnabled()).toBe(true);
  });

  it('writes rows captured while a flush was in flight, with no further capture', async () => {
    // Regression: a `flush()` call landing mid-write joins the in-flight promise
    // instead of queueing a second pass, and the timer that would have covered
    // the new rows has already fired. Without a reschedule when the write
    // settles, the queue sat there until some later capture happened to schedule
    // one — so the last rows of a burst could never be written at all.
    const { database, batches, hold } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    const release = hold();
    queue.add(networkEvent('n1'));
    await jest.advanceTimersByTimeAsync(250);

    // Captured while the first write is still held open.
    queue.add(networkEvent('n2'));
    await jest.advanceTimersByTimeAsync(250);

    release();
    await jest.advanceTimersByTimeAsync(250);

    const written = batches.flatMap((batch) =>
      batch.inserts.map((event) => event.id)
    );
    expect(written).toEqual(['n1', 'n2']);
    expect(queue.pendingCount()).toBe(0);
  });
});

describe('the crash path', () => {
  it('writes without waiting on a promise, so a dying process still records', () => {
    const { database, batches } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    queue.add(consoleEvent('c1', 'last log before the crash'));
    queue.add(consoleEvent('c2', 'Error: boom'));

    // No await, no timer: everything is on disk by the time this returns, which
    // is all the crash handler gets before RN tears the app down.
    expect(queue.flushSync()).toBe(true);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.inserts.map((event) => event.id)).toEqual(['c1', 'c2']);
    expect(queue.pendingCount()).toBe(0);
  });

  it('keeps the rows queued when the sync write fails, so an async flush can retry', async () => {
    const { database, batches, failNext } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    queue.add(consoleEvent('c1', 'Error: boom'));
    failNext(1);

    expect(queue.flushSync()).toBe(false);
    expect(batches).toHaveLength(0);
    expect(queue.pendingCount()).toBe(1);

    // The error was non-fatal after all — the app lives, and the fallback lands.
    await queue.flush();
    expect(batches[0]?.inserts.map((event) => event.id)).toEqual(['c1']);
  });

  it('does not count a sync failure toward disabling persistence', () => {
    const { database, failNext } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    // A crash loop against a database that never opened must not turn capture
    // off for the rest of the session — the sync path fails for reasons of its
    // own (no `await ready`), which say nothing about the async one.
    failNext(MAX_CONSECUTIVE_FAILURES + 1);
    for (let i = 0; i <= MAX_CONSECUTIVE_FAILURES; i += 1) {
      queue.add(consoleEvent(`c${i}`, 'Error: boom'));
      queue.flushSync();
    }

    expect(queue.isEnabled()).toBe(true);
  });

  it('reports the rows as readable so an open drawer refreshes', () => {
    const { database } = recordingDatabase();
    const flushed: string[] = [];
    const queue = new EventQueue({
      eventRepository: database.events,
      onFlushed: (kinds) => flushed.push(...kinds),
    });

    queue.add(consoleEvent('c1', 'Error: boom'));
    queue.flushSync();

    expect(flushed).toEqual(['console']);
  });

  it('is a no-op with nothing pending', () => {
    const { database, batches } = recordingDatabase();
    const queue = new EventQueue({ eventRepository: database.events });

    expect(queue.flushSync()).toBe(true);
    expect(batches).toHaveLength(0);
  });

  it('lands in real SQL, readable by the next launch', async () => {
    const sql = createNodeDatabase();
    const database = openDatabase(sql);
    await database.ready();
    await database.sessions.save({
      id: SESSION,
      startedAt: 1,
      status: 'open',
    });
    const queue = new EventQueue({ eventRepository: database.events });

    queue.add(consoleEvent('c1', 'about to divide by zero'));
    const crash: ConsoleEvent = {
      id: 'c2',
      sessionId: SESSION,
      timestamp: 2_000,
      kind: 'console',
      level: 'uncaught',
      message: 'TypeError: boom',
      messageTruncated: false,
      stack: 'TypeError: boom\n  at App',
      fatal: true,
    };
    queue.add(crash);

    expect(queue.flushSync()).toBe(true);

    const loaded = (await database.events.load(
      'console',
      'c2'
    )) as ConsoleEvent;
    expect(loaded).toMatchObject({
      level: 'uncaught',
      message: 'TypeError: boom',
      fatal: true,
    });
    // The counters move in the same transaction as the rows.
    const sessions = await database.sessions.list();
    expect(sessions[0]?.eventCount).toBe(2);
    sql.close();
  });

  it('cannot write before the database is open, and says so', async () => {
    const sql = createNodeDatabase();
    const database = openDatabase(sql);
    const queue = new EventQueue({ eventRepository: database.events });

    // `ready()` deliberately not awaited yet: this is a crash in the first
    // moments of startup, where there is no round trip to wait for.
    queue.add(consoleEvent('c1', 'Error: boom'));

    expect(queue.flushSync()).toBe(false);
    expect(queue.pendingCount()).toBe(1);

    await database.ready(); // let the open settle before releasing the handle
    sql.close();
  });
});

describe('end to end against real SQL', () => {
  it('persists a realistic capture burst', async () => {
    const sql = createNodeDatabase();
    const database = openDatabase(sql);
    await database.ready();
    await database.sessions.save({
      id: SESSION,
      startedAt: 1,
      status: 'open',
    });
    const queue = new EventQueue({ eventRepository: database.events });

    // A request that completes in phases, plus some logs — the common shape.
    queue.add(networkEvent('n1'));
    queue.add(consoleEvent('c1', 'hello'));
    await queue.flush();
    queue.update('n1', 'network', { phase: 'success', status: 200 });
    queue.update('n1', 'network', { durationMs: 34 });
    await queue.flush();

    const loaded = (await database.events.load(
      'network',
      'n1'
    )) as NetworkEvent;
    expect(loaded).toMatchObject({
      phase: 'success',
      status: 200,
      durationMs: 34,
    });

    const sessions = await database.sessions.list();
    expect(sessions[0]?.eventCount).toBe(2);
    sql.close();
  });
});

// ── Draining ─────────────────────────────────────────────────────────────────

describe('draining the pipeline', () => {
  it('covers rows captured while an earlier write was in flight', async () => {
    const { database, batches, hold } = recordingDatabase();
    const capture = startCapture(database.events);

    const release = hold();
    captureEvent(consoleEvent('c1', 'first'));
    const inFlight = capture.flush();
    captureEvent(consoleEvent('c2', 'captured mid-write'));
    // Joins the write already running rather than starting one, so it says
    // nothing about c2 — which is why the re-key cannot rely on `flush()`.
    const joined = capture.flush();

    release();
    await inFlight;
    await joined;
    expect(
      batches.map((batch) => batch.inserts.map((event) => event.id))
    ).toEqual([['c1']]);

    await capture.drain();

    expect(
      batches.map((batch) => batch.inserts.map((event) => event.id))
    ).toEqual([['c1'], ['c2']]);
    capture.stop();
  });

  it('gives up rather than spinning when writes keep failing', async () => {
    const { database, failNext } = recordingDatabase();
    const capture = startCapture(database.events);

    // Fewer than the queue's give-up threshold, so it stays enabled and keeps
    // putting the rows back — the shape that would hang an unbounded loop.
    failNext(MAX_CONSECUTIVE_FAILURES - 1);
    captureEvent(consoleEvent('c1', 'first'));

    await expect(capture.drain()).resolves.toBeUndefined();
    capture.stop();
  });
});
