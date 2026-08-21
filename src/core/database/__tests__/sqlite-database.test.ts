/**
 * Adapter tests against a real SQLite engine (`node:sqlite`), so the schema,
 * indexes and every query actually execute.
 *
 * The pagination cases are the point of this file: keyset paging is easy to get
 * subtly wrong in ways a fake would never reveal — a boundary that repeats a row,
 * a tie on `timestamp` that loses one, an `OFFSET`-style drift under concurrent
 * inserts.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDatabase } from '../sqlite-database';
import { createNodeDatabase, type NodeDatabase } from './node-database';
import { TABLES } from '../rows';
import type {
  AsyncStorageEvent,
  ConsoleEvent,
  BesouroEvent,
  NetworkEvent,
  SessionMeta,
  WebSocketEvent,
} from '../../types';
import type { Database } from '../types';

const SESSION = 'session-1';

let database: NodeDatabase;
let adapter: Database;

beforeEach(async () => {
  database = createNodeDatabase();
  adapter = openDatabase(database);
  await adapter.ready();
  await adapter.sessions.save(session(SESSION));
});

afterEach(() => {
  database.close();
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

function session(
  id: string,
  overrides: Partial<SessionMeta> = {}
): SessionMeta {
  return { id, startedAt: 1_000, status: 'open', ...overrides };
}

function networkEvent(
  id: string,
  timestamp: number,
  overrides: Partial<NetworkEvent> = {}
): NetworkEvent {
  return {
    id,
    sessionId: SESSION,
    timestamp,
    kind: 'network',
    method: 'GET',
    url: `https://example.com/${id}`,
    requestHeaders: { accept: 'application/json' },
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    phase: 'success',
    status: 200,
    ...overrides,
  };
}

function consoleEvent(
  id: string,
  timestamp: number,
  message: string
): ConsoleEvent {
  return {
    id,
    sessionId: SESSION,
    timestamp,
    kind: 'console',
    level: 'log',
    message,
    messageTruncated: false,
  };
}

function socketEvent(
  id: string,
  timestamp: number,
  connectionId: string,
  overrides: Partial<WebSocketEvent> = {}
): WebSocketEvent {
  return {
    id,
    sessionId: SESSION,
    timestamp,
    kind: 'websocket',
    connectionId,
    url: `wss://example.com/${connectionId}`,
    direction: 'send',
    type: 'message',
    payloadTruncated: false,
    ...overrides,
  };
}

/** Insert `count` network events with descending-friendly ids and timestamps. */
async function seedNetwork(
  count: number,
  startAt = 1_000
): Promise<NetworkEvent[]> {
  const events = Array.from({ length: count }, (_, index) =>
    networkEvent(`n${String(index).padStart(3, '0')}`, startAt + index)
  );
  await adapter.events.commit({ inserts: events, updates: [] });
  return events;
}

/** Walk every page, returning the ids in the order they were served. */
async function walkAll(
  kind: BesouroEvent['kind'],
  limit: number,
  extra: { search?: string; group?: string } = {}
): Promise<string[]> {
  const ids: string[] = [];
  let cursor = undefined as undefined | { timestamp: number; id: string };
  for (;;) {
    const page = await adapter.events.query({
      sessionId: SESSION,
      kind,
      limit,
      before: cursor,
      ...extra,
    });
    ids.push(...page.rows.map((row) => row.id));
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  }
  return ids;
}

// ── Basics ───────────────────────────────────────────────────────────────────

describe('schema and round-trip', () => {
  it('creates a table for every event kind', async () => {
    for (const spec of Object.values(TABLES)) {
      const count = await adapter.events.count(SESSION, spec.kind);
      expect(count).toBe(0);
    }
  });

  it('round-trips an event through insert and detail load', async () => {
    const event = networkEvent('n1', 5_000, {
      requestBody: '{"a":1}',
      responseBody: '{"ok":true}',
      responseHeaders: { 'content-type': 'application/json' },
      durationMs: 42,
    });
    await adapter.events.commit({ inserts: [event], updates: [] });

    const loaded = (await adapter.events.load('network', 'n1')) as NetworkEvent;
    expect(loaded).toMatchObject({
      id: 'n1',
      kind: 'network',
      method: 'GET',
      status: 200,
      durationMs: 42,
      requestBody: '{"a":1}',
      responseBody: '{"ok":true}',
      requestBodyTruncated: false,
      responseBodyTruncated: false,
    });
    // JSON columns come back as real objects, not strings.
    expect(loaded.responseHeaders).toEqual({
      'content-type': 'application/json',
    });
  });

  it('omits heavy columns from list rows but keeps them loadable', async () => {
    await adapter.events.commit({
      inserts: [
        networkEvent('n1', 5_000, {
          responseBody: 'x'.repeat(10_000),
          responseImageUri: 'data:image/png;base64,AAAA',
        }),
      ],
      updates: [],
    });

    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'network',
      limit: 10,
    });
    const row = page.rows[0] as NetworkEvent;
    expect(row.url).toBe('https://example.com/n1');
    // The whole point: bodies and image previews never reach a list.
    expect(row.responseBody).toBeUndefined();
    expect(row.responseImageUri).toBeUndefined();

    const full = (await adapter.events.load('network', 'n1')) as NetworkEvent;
    expect(full.responseBody).toHaveLength(10_000);
    expect(full.responseImageUri).toBe('data:image/png;base64,AAAA');
  });

  it('applies updates without disturbing unmentioned columns', async () => {
    await adapter.events.commit({
      inserts: [
        networkEvent('n1', 5_000, { phase: 'pending', status: undefined }),
      ],
      updates: [],
    });
    await adapter.events.commit({
      inserts: [],
      updates: [
        {
          id: 'n1',
          kind: 'network',
          patch: { phase: 'success', status: 201, durationMs: 12 },
        },
      ],
    });

    const loaded = (await adapter.events.load('network', 'n1')) as NetworkEvent;
    expect(loaded.phase).toBe('success');
    expect(loaded.status).toBe(201);
    expect(loaded.durationMs).toBe(12);
    expect(loaded.method).toBe('GET'); // untouched by the patch
  });

  it('clears an explicitly-null field (an evicted image preview)', async () => {
    await adapter.events.commit({
      inserts: [
        networkEvent('n1', 5_000, {
          responseImageUri: 'data:image/png;base64,AA',
        }),
      ],
      updates: [],
    });
    await adapter.events.commit({
      inserts: [],
      updates: [
        { id: 'n1', kind: 'network', patch: { responseImageUri: undefined } },
      ],
    });
    const loaded = (await adapter.events.load('network', 'n1')) as NetworkEvent;
    expect(loaded.responseImageUri).toBeUndefined();
  });
});

// ── Pagination ───────────────────────────────────────────────────────────────

describe('keyset pagination', () => {
  it('serves newest first', async () => {
    await seedNetwork(5);
    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'network',
      limit: 10,
    });
    expect(page.rows.map((row) => row.id)).toEqual([
      'n004',
      'n003',
      'n002',
      'n001',
      'n000',
    ]);
  });

  it('returns every row exactly once across a full walk', async () => {
    const events = await seedNetwork(47);
    const ids = await walkAll('network', 10);

    expect(ids).toHaveLength(47);
    expect(new Set(ids).size).toBe(47);
    // Newest first, which is the reverse of insertion order.
    expect(ids).toEqual([...events].reverse().map((event) => event.id));
  });

  it('reports hasMore exactly on the last page', async () => {
    await seedNetwork(20);

    const full = await adapter.events.query({
      sessionId: SESSION,
      kind: 'network',
      limit: 10,
    });
    expect(full.rows).toHaveLength(10);
    expect(full.hasMore).toBe(true);
    expect(full.cursor).not.toBeNull();

    const last = await adapter.events.query({
      sessionId: SESSION,
      kind: 'network',
      limit: 10,
      before: full.cursor!,
    });
    expect(last.rows).toHaveLength(10);
    expect(last.hasMore).toBe(false);
    expect(last.cursor).toBeNull();
  });

  it('handles an exact multiple of the page size', async () => {
    await seedNetwork(10);
    const first = await adapter.events.query({
      sessionId: SESSION,
      kind: 'network',
      limit: 10,
    });
    // 10 rows for a limit of 10 must not claim a further page.
    expect(first.rows).toHaveLength(10);
    expect(first.hasMore).toBe(false);
  });

  it('does not skip or duplicate when rows arrive at the head mid-walk', async () => {
    const original = await seedNetwork(20);

    const first = await adapter.events.query({
      sessionId: SESSION,
      kind: 'network',
      limit: 5,
    });

    // Five newer events land between page fetches — the case OFFSET gets wrong.
    await adapter.events.commit({
      inserts: Array.from({ length: 5 }, (_, index) =>
        networkEvent(`live${index}`, 9_000 + index)
      ),
      updates: [],
    });

    const ids = [...first.rows.map((row) => row.id)];
    let cursor = first.cursor;
    while (cursor) {
      const page = await adapter.events.query({
        sessionId: SESSION,
        kind: 'network',
        limit: 5,
        before: cursor,
      });
      ids.push(...page.rows.map((row) => row.id));
      cursor = page.hasMore ? page.cursor : null;
    }

    // Every original row appears exactly once; the newcomers are simply above the
    // cursor and correctly absent from this walk.
    expect(new Set(ids).size).toBe(ids.length);
    for (const event of original) {
      expect(ids).toContain(event.id);
    }
    expect(ids.filter((id) => id.startsWith('live'))).toHaveLength(0);
  });

  it('serves a growing window without duplicating or skipping under live inserts', async () => {
    // How the drawer actually paginates: "show one more page" widens the limit and
    // re-reads the whole window in one query, rather than fetching a page to
    // concatenate onto what is on screen. Two queries taken at different instants
    // cannot be stitched together safely — the overlap is what produced duplicate
    // React keys — so the window read has to be self-consistent on its own.
    await seedNetwork(20);

    let previous: string[] = [];
    for (let window = 5; window <= 40; window += 5) {
      // Rows keep arriving at the head between reads, as during live capture.
      await adapter.events.commit({
        inserts: [networkEvent(`live${window}`, 9_000 + window)],
        updates: [],
      });

      const page = await adapter.events.query({
        sessionId: SESSION,
        kind: 'network',
        limit: window,
      });
      const ids = page.rows.map((row) => row.id);

      expect(new Set(ids).size).toBe(ids.length);
      // A window only ever grows downward: everything it showed before is still
      // there, still in order, with newcomers prepended.
      expect(ids.filter((id) => previous.includes(id))).toEqual(
        previous.filter((id) => ids.includes(id))
      );
      previous = ids;
    }

    expect(previous).toHaveLength(28);
  });

  it('pages correctly when timestamps tie', async () => {
    // All ten share a timestamp, so only the id tiebreaker can order them.
    const events = Array.from({ length: 10 }, (_, index) =>
      networkEvent(`t${String(index).padStart(2, '0')}`, 7_777)
    );
    await adapter.events.commit({ inserts: events, updates: [] });

    const ids = await walkAll('network', 3);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids).toEqual([...events].reverse().map((event) => event.id));
  });

  it('returns an empty page for a session with no events', async () => {
    const page = await adapter.events.query({
      sessionId: 'nobody',
      kind: 'network',
      limit: 10,
    });
    expect(page.rows).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBeNull();
  });
});

// ── Search ───────────────────────────────────────────────────────────────────

describe('search', () => {
  it('matches case-insensitively across searchable columns', async () => {
    await adapter.events.commit({
      inserts: [
        networkEvent('a', 1, { url: 'https://api.example.com/Users' }),
        networkEvent('b', 2, { url: 'https://api.example.com/orders' }),
        networkEvent('c', 3, { url: 'https://cdn.example.com/logo.png' }),
      ],
      updates: [],
    });

    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'network',
      limit: 10,
      search: 'USERS',
    });
    expect(page.rows.map((row) => row.id)).toEqual(['a']);
  });

  it('searches an integer column (a status code)', async () => {
    await adapter.events.commit({
      inserts: [
        networkEvent('ok', 1, { status: 200 }),
        networkEvent('missing', 2, { status: 404 }),
      ],
      updates: [],
    });
    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'network',
      limit: 10,
      search: '404',
    });
    expect(page.rows.map((row) => row.id)).toEqual(['missing']);
  });

  it('searches heavy columns without selecting them', async () => {
    await adapter.events.commit({
      inserts: [
        consoleEvent('c1', 1, 'nothing interesting'),
        consoleEvent('c2', 2, 'a needle in here'),
      ],
      updates: [],
    });
    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'console',
      limit: 10,
      search: 'needle',
    });
    expect(page.rows.map((row) => row.id)).toEqual(['c2']);
  });

  it('treats LIKE wildcards in the query as literal characters', async () => {
    await adapter.events.commit({
      inserts: [
        networkEvent('under', 1, { url: 'https://example.com/a_b' }),
        networkEvent('other', 2, { url: 'https://example.com/axb' }),
      ],
      updates: [],
    });
    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'network',
      limit: 10,
      search: 'a_b',
    });
    // Without escaping, `_` would match any character and pull in `axb` too.
    expect(page.rows.map((row) => row.id)).toEqual(['under']);
  });

  it('combines search with the keyset cursor', async () => {
    await adapter.events.commit({
      inserts: Array.from({ length: 12 }, (_, index) =>
        networkEvent(`m${String(index).padStart(2, '0')}`, 1_000 + index, {
          url:
            index % 2 === 0
              ? 'https://example.com/match'
              : 'https://example.com/other',
        })
      ),
      updates: [],
    });

    const ids = await walkAll('network', 2, { search: 'match' });
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids.every((id) => Number(id.slice(1)) % 2 === 0)).toBe(true);
  });
});

// ── Grouped tabs ─────────────────────────────────────────────────────────────

describe('grouped queries', () => {
  it('aggregates per connection and reports the newest lifecycle frame', async () => {
    await adapter.events.commit({
      inserts: [
        socketEvent('w1', 100, 'conn-a', {
          direction: 'lifecycle',
          type: 'open',
        }),
        socketEvent('w2', 200, 'conn-a'),
        socketEvent('w3', 300, 'conn-a', {
          direction: 'lifecycle',
          type: 'close',
          closeCode: 1000,
        }),
        socketEvent('w4', 150, 'conn-b', {
          direction: 'lifecycle',
          type: 'open',
        }),
        socketEvent('w5', 250, 'conn-b'),
      ],
      updates: [],
    });

    const groups = await adapter.events.groups({
      sessionId: SESSION,
      kind: 'websocket',
      latestWhere: { field: 'direction', value: 'lifecycle' },
    });
    const byKey = new Map(groups.map((group) => [group.key, group]));

    // Counts cover every frame, not just lifecycle ones.
    expect(byKey.get('conn-a')?.count).toBe(3);
    expect(byKey.get('conn-a')?.firstAt).toBe(100);
    expect(byKey.get('conn-a')?.lastAt).toBe(300);
    // `latest` is the newest *lifecycle* frame — what drives connection status.
    expect((byKey.get('conn-a')?.latest as WebSocketEvent).type).toBe('close');
    expect((byKey.get('conn-b')?.latest as WebSocketEvent).type).toBe('open');
  });

  it('pages frames within one connection', async () => {
    await adapter.events.commit({
      inserts: [
        ...Array.from({ length: 10 }, (_, index) =>
          socketEvent(`a${index}`, 100 + index, 'conn-a')
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          socketEvent(`b${index}`, 100 + index, 'conn-b')
        ),
      ],
      updates: [],
    });

    const ids = await walkAll('websocket', 4, { group: 'conn-a' });
    expect(ids).toHaveLength(10);
    expect(ids.every((id) => id.startsWith('a'))).toBe(true);
  });

  it('counts changes per zustand store', async () => {
    await adapter.events.commit({
      inserts: [
        {
          id: 'z1',
          sessionId: SESSION,
          timestamp: 1,
          kind: 'zustand',
          storeId: 'cart',
          storeName: 'Cart',
          isInitial: true,
          isReload: false,
          changedKeys: [],
          stateTruncated: false,
        },
        {
          id: 'z2',
          sessionId: SESSION,
          timestamp: 2,
          kind: 'zustand',
          storeId: 'cart',
          storeName: 'Cart',
          isInitial: false,
          isReload: false,
          changedKeys: ['items'],
          stateTruncated: false,
        },
        {
          id: 'z3',
          sessionId: SESSION,
          timestamp: 3,
          kind: 'zustand',
          storeId: 'user',
          storeName: 'User',
          isInitial: true,
          isReload: false,
          changedKeys: [],
          stateTruncated: false,
        },
      ],
      updates: [],
    });

    const groups = await adapter.events.groups({
      sessionId: SESSION,
      kind: 'zustand',
    });
    const counts = new Map(groups.map((group) => [group.key, group.count]));
    expect(counts.get('cart')).toBe(2);
    expect(counts.get('user')).toBe(1);
  });

  it('returns no groups for a kind without a group column', async () => {
    await seedNetwork(3);
    const groups = await adapter.events.groups({
      sessionId: SESSION,
      kind: 'network',
    });
    expect(groups).toEqual([]);
  });
});

// ── Sessions and retention ───────────────────────────────────────────────────

describe('sessions', () => {
  it('maintains event count and last-event timestamp as rows land', async () => {
    await adapter.events.commit({
      inserts: [networkEvent('n1', 500), networkEvent('n2', 900)],
      updates: [],
    });
    await adapter.events.commit({
      inserts: [consoleEvent('c1', 1_500, 'hi')],
      updates: [],
    });

    const [meta] = await adapter.sessions.list();
    expect(meta?.eventCount).toBe(3);
    expect(meta?.lastEventAt).toBe(1_500);
  });

  it('adopts rows already on disk when the session row is written after them', async () => {
    // The startup order, which the `beforeEach` above deliberately does not use:
    // capture flushes before the lifecycle writes the session, so those bumps
    // found no row to update and were dropped. The rows are readable either
    // way — without this the session under-reports them forever.
    const early: BesouroEvent[] = [
      { ...consoleEvent('c1', 400, 'Running "main"'), sessionId: 'late' },
      { ...networkEvent('n1', 700), sessionId: 'late' },
    ];
    await adapter.events.commit({ inserts: early, updates: [] });

    await adapter.sessions.save(session('late'));

    const meta = (await adapter.sessions.list()).find(
      (entry) => entry.id === 'late'
    );
    expect(meta?.eventCount).toBe(2);
    expect(meta?.lastEventAt).toBe(700);
  });

  it('does not recount a session whose counter is already set', async () => {
    await adapter.events.commit({
      inserts: [networkEvent('n1', 500)],
      updates: [],
    });
    // Behind the adapter's back, so a recount would disagree with the stored
    // total: the counter is the writer's running tally, adopted once when the
    // row is created and incremented from then on.
    await database.execute('DELETE FROM network WHERE id = ?', ['n1']);

    await adapter.sessions.save(session(SESSION, { status: 'closed' }));

    const [meta] = await adapter.sessions.list();
    expect(meta?.eventCount).toBe(1);
  });

  it('leaves a session with no rows at zero', async () => {
    await adapter.sessions.save(session('empty'));
    const meta = (await adapter.sessions.list()).find(
      (entry) => entry.id === 'empty'
    );
    expect(meta?.eventCount).toBe(0);
    expect(meta?.lastEventAt).toBeUndefined();
  });

  it('does not reset counters when session meta is re-saved', async () => {
    await adapter.events.commit({
      inserts: [networkEvent('n1', 500)],
      updates: [],
    });
    await adapter.sessions.save(
      session(SESSION, { status: 'closed', endedAt: 2_000 })
    );

    const [meta] = await adapter.sessions.list();
    expect(meta?.status).toBe('closed');
    expect(meta?.endedAt).toBe(2_000);
    // The counter is the writer's, not the meta save's, to clobber.
    expect(meta?.eventCount).toBe(1);
  });

  it('round-trips the inspectors the session was recording', async () => {
    await adapter.sessions.save(
      session('recorded', { inspectors: ['network', 'console'] })
    );
    const meta = (await adapter.sessions.list()).find(
      (entry) => entry.id === 'recorded'
    );
    expect(meta?.inspectors).toEqual(['network', 'console']);
  });

  it('reports an unrecorded inspector set as unknown, not empty', async () => {
    // The column is null for a session written before it existed; the panel
    // reads that as "assume the live set", which an empty array would not say.
    const [meta] = await adapter.sessions.list();
    expect(meta?.inspectors).toBeUndefined();
  });

  it('ignores an inspectors column that is not an array of ids', async () => {
    await database.execute('UPDATE sessions SET inspectors = ? WHERE id = ?', [
      '{"network":true}',
      SESSION,
    ]);
    expect((await adapter.sessions.list())[0]?.inspectors).toBeUndefined();

    await database.execute('UPDATE sessions SET inspectors = ? WHERE id = ?', [
      '["network",',
      SESSION,
    ]);
    expect((await adapter.sessions.list())[0]?.inspectors).toBeUndefined();
  });

  it('lists sessions newest first', async () => {
    await adapter.sessions.save(session('older', { startedAt: 10 }));
    await adapter.sessions.save(session('newer', { startedAt: 9_999 }));
    const ids = (await adapter.sessions.list()).map((meta) => meta.id);
    expect(ids[0]).toBe('newer');
    expect(ids.indexOf('newer')).toBeLessThan(ids.indexOf('older'));
  });

  it('clears one kind without touching the others', async () => {
    await adapter.events.commit({
      inserts: [networkEvent('n1', 1), consoleEvent('c1', 2, 'kept')],
      updates: [],
    });

    await adapter.events.clear(SESSION, 'network');

    expect(await adapter.events.count(SESSION, 'network')).toBe(0);
    expect(await adapter.events.count(SESSION, 'console')).toBe(1);
    const [meta] = await adapter.sessions.list();
    expect(meta?.eventCount).toBe(1);
  });

  it('deletes sessions and every row they own, across all tables', async () => {
    await adapter.sessions.save(session('doomed', { startedAt: 50 }));
    const doomedEvents: BesouroEvent[] = [
      { ...networkEvent('dn', 1), sessionId: 'doomed' },
      { ...consoleEvent('dc', 2, 'bye'), sessionId: 'doomed' },
      { ...socketEvent('dw', 3, 'conn'), sessionId: 'doomed' },
      {
        ...({
          id: 'da',
          sessionId: 'doomed',
          timestamp: 4,
          kind: 'asyncStorage',
          operation: 'setItem',
          keys: ['k'],
          valueTruncated: false,
          direction: 'write',
        } as AsyncStorageEvent),
      },
    ];
    await adapter.events.commit({ inserts: doomedEvents, updates: [] });
    await adapter.events.commit({
      inserts: [networkEvent('keep', 1)],
      updates: [],
    });

    await adapter.sessions.deleteMany(['doomed']);

    expect((await adapter.sessions.list()).map((meta) => meta.id)).toEqual([
      SESSION,
    ]);
    for (const spec of Object.values(TABLES)) {
      expect(await adapter.events.count('doomed', spec.kind)).toBe(0);
    }
    // The surviving session is untouched.
    expect(await adapter.events.count(SESSION, 'network')).toBe(1);
  });

  it('ignores an empty bulk delete', async () => {
    await adapter.sessions.deleteMany([]);
    expect(await adapter.sessions.list()).toHaveLength(1);
  });
});

// ── Rows written under an id no session carries ──────────────────────────────

describe('reassigning rows to another session', () => {
  /**
   * The warm-reload shape: this launch started a session of its own, captured
   * its startup rows under it, and only then learned it should be continuing the
   * previous one. `fresh` is the discarded id, and never had a session row.
   */
  async function seedWarmReload(): Promise<void> {
    await adapter.events.commit({
      inserts: [consoleEvent('c-old', 100, 'before the reload')],
      updates: [],
    });
    await adapter.events.commit({
      inserts: [
        { ...consoleEvent('c-new', 500, 'Running "main"'), sessionId: 'fresh' },
        { ...networkEvent('n-new', 600), sessionId: 'fresh' },
      ],
      updates: [],
    });
  }

  it('moves every row onto the adopted session and recounts it', async () => {
    await seedWarmReload();

    await adapter.sessions.reassignEvents('fresh', SESSION);

    expect(await adapter.events.count(SESSION, 'console')).toBe(2);
    expect(await adapter.events.count(SESSION, 'network')).toBe(1);
    expect(await adapter.events.count('fresh', 'console')).toBe(0);

    const [meta] = await adapter.sessions.list();
    // Recounted, not incremented: `c-old` was counted when it landed, the two
    // moved rows never were (they had no session row to bump).
    expect(meta?.eventCount).toBe(3);
    expect(meta?.lastEventAt).toBe(600);
  });

  it('keeps the rows readable under the adopted id', async () => {
    await seedWarmReload();

    await adapter.sessions.reassignEvents('fresh', SESSION);

    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'console',
      limit: 10,
    });
    expect(page.rows.map((row) => row.id)).toEqual(['c-new', 'c-old']);
  });

  it('does nothing when the ids are the same', async () => {
    await adapter.events.commit({
      inserts: [consoleEvent('c1', 100, 'kept')],
      updates: [],
    });

    await adapter.sessions.reassignEvents(SESSION, SESSION);

    expect(await adapter.events.count(SESSION, 'console')).toBe(1);
    expect((await adapter.sessions.list())[0]?.eventCount).toBe(1);
  });
});

describe('collecting orphaned rows', () => {
  it('deletes rows whose session was never written, sparing the live one', async () => {
    await adapter.events.commit({
      inserts: [
        consoleEvent('kept', 100, 'belongs to a saved session'),
        { ...consoleEvent('live', 200, 'Running "main"'), sessionId: 'live' },
        {
          ...consoleEvent('orphan-c', 300, 'nobody owns me'),
          sessionId: 'gone',
        },
        { ...networkEvent('orphan-n', 400), sessionId: 'gone' },
      ],
      updates: [],
    });

    // The live session's own rows precede its first metadata write, which is
    // exactly the state this must not mistake for an orphan.
    await adapter.sessions.deleteOrphanedEvents('live');

    expect(await adapter.events.count(SESSION, 'console')).toBe(1);
    expect(await adapter.events.count('live', 'console')).toBe(1);
    expect(await adapter.events.count('gone', 'console')).toBe(0);
    expect(await adapter.events.count('gone', 'network')).toBe(0);
  });

  it('leaves a database with nothing orphaned untouched', async () => {
    await adapter.events.commit({
      inserts: [consoleEvent('c1', 100, 'kept')],
      updates: [],
    });

    await adapter.sessions.deleteOrphanedEvents(SESSION);

    expect(await adapter.events.count(SESSION, 'console')).toBe(1);
  });
});

// ── Batching ─────────────────────────────────────────────────────────────────

describe('batching', () => {
  it('writes a whole flush in a single transaction', async () => {
    database.log.length = 0;
    await adapter.events.commit({
      inserts: [networkEvent('n1', 1), networkEvent('n2', 2)],
      updates: [{ id: 'n1', kind: 'network', patch: { status: 500 } }],
    });

    // Two inserts + one update + one session-counter bump, and no per-row
    // round trip beyond that.
    expect(database.log.filter((sql) => sql.startsWith('INSERT'))).toHaveLength(
      2
    );
    expect(database.log.filter((sql) => sql.startsWith('UPDATE'))).toHaveLength(
      2
    );
  });

  it('is a no-op for an empty batch', async () => {
    database.log.length = 0;
    await adapter.events.commit({ inserts: [], updates: [] });
    expect(database.log).toHaveLength(0);
  });
});
