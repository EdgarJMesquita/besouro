/**
 * The two queries the MMKV tab's panes run, against a real SQLite engine.
 *
 * MMKV is the first caller to combine `group` with `where`, and the first to filter
 * on a `bool` column whose value arrives as the string `'1'`. Both are the kind of
 * thing a fake would wave through and a device would not, and both were suspects
 * when the Store pane came up empty — so they are pinned here where the SQL actually
 * executes.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDatabase } from '../sqlite-database';
import { createNodeDatabase, type NodeDatabase } from './node-database';
import type { MMKVEvent } from '../../types';
import type { Database } from '../types';

const SESSION = 'session-1';

let database: NodeDatabase;
let adapter: Database;

beforeEach(async () => {
  database = createNodeDatabase();
  adapter = openDatabase(database);
  await adapter.ready();
  await adapter.sessions.save({ id: SESSION, startedAt: 1, status: 'open' });
});

afterEach(() => {
  database.close();
});

function change(id: string, instanceId: string, key: string): MMKVEvent {
  return {
    id,
    sessionId: SESSION,
    timestamp: Number(id.slice(1)),
    kind: 'mmkv',
    instanceId,
    instanceName: 'default',
    operation: 'set',
    key,
    valueType: 'string',
    direction: 'write',
    isFinal: false,
    value: 'v',
    valueTruncated: false,
  };
}

function snapshot(id: string, instanceId: string, contents: string): MMKVEvent {
  return {
    id,
    sessionId: SESSION,
    timestamp: Number(id.slice(1)),
    kind: 'mmkv',
    instanceId,
    instanceName: 'default',
    operation: 'snapshot',
    direction: 'read',
    isFinal: true,
    value: contents,
    valueTruncated: false,
  };
}

describe('mmkv queries', () => {
  beforeEach(async () => {
    await adapter.events.commit({
      inserts: [
        snapshot('e1', 'mmkv-1', '{"token":"abc"}'),
        change('e2', 'mmkv-1', 'token'),
        change('e3', 'mmkv-2', 'theme'),
        snapshot('e4', 'mmkv-2', '{"theme":"dark"}'),
      ],
      updates: [],
    });
  });

  it("finds one instance's snapshot row — the Store pane query", async () => {
    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'mmkv',
      group: 'mmkv-1',
      where: { field: 'isFinal', value: '1' },
      limit: 20,
    });

    // `group` and `where` must AND, not replace one another.
    expect(page.rows.map((row) => row.id)).toEqual(['e1']);
  });

  it("excludes the snapshot row from the instance's log — the Operations query", async () => {
    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'mmkv',
      group: 'mmkv-1',
      where: { field: 'isFinal', value: '0' },
      limit: 20,
    });

    expect(page.rows.map((row) => row.id)).toEqual(['e2']);
  });

  it('round-trips the snapshot contents through the heavy column', async () => {
    // `value` is heavy, so the page query must not carry it and `load` must.
    const [summary] = (
      await adapter.events.query({
        sessionId: SESSION,
        kind: 'mmkv',
        group: 'mmkv-2',
        where: { field: 'isFinal', value: '1' },
        limit: 20,
      })
    ).rows as MMKVEvent[];
    expect(summary?.value).toBeUndefined();

    const full = (await adapter.events.load('mmkv', 'e4')) as MMKVEvent;
    expect(full.value).toBe('{"theme":"dark"}');
    expect(full.isFinal).toBe(true);
  });

  it('clears the operations and keeps the snapshot — what Clear means here', async () => {
    await adapter.events.clear(SESSION, 'mmkv');

    // The Store pane's query, run again after the clear: the contents are still
    // there. Clearing the log never claimed to have emptied the app's storage,
    // and the interceptor goes on patching this row for the rest of the session.
    const store = await adapter.events.query({
      sessionId: SESSION,
      kind: 'mmkv',
      group: 'mmkv-1',
      where: { field: 'isFinal', value: '1' },
      limit: 20,
    });
    expect(store.rows.map((row) => row.id)).toEqual(['e1']);
    expect(((await adapter.events.load('mmkv', 'e1')) as MMKVEvent).value).toBe(
      '{"token":"abc"}'
    );

    // The log is what went: every instance is down to its snapshot alone, so the
    // list's `count - 1` reads as zero changes rather than as a missing instance.
    const groups = await adapter.events.groups({
      sessionId: SESSION,
      kind: 'mmkv',
    });
    expect(groups.map((entry) => [entry.key, entry.count]).sort()).toEqual([
      ['mmkv-1', 1],
      ['mmkv-2', 1],
    ]);

    // Counted rows and the session's stored total move together.
    expect(await adapter.events.count(SESSION, 'mmkv')).toBe(2);
    expect((await adapter.sessions.list())[0]?.eventCount).toBe(2);
  });

  it('counts every row per instance, snapshot included', async () => {
    const groups = await adapter.events.groups({
      sessionId: SESSION,
      kind: 'mmkv',
    });

    // `count` stays the whole group — it is what dates the instance and what a
    // search narrows. Only `changeCount` knows about snapshots, and only when asked.
    expect(groups.map((entry) => [entry.key, entry.count]).sort()).toEqual([
      ['mmkv-1', 2],
      ['mmkv-2', 2],
    ]);
    expect(groups.every((entry) => entry.changeCount === entry.count)).toBe(
      true
    );
  });

  it('counts operations without the snapshot when asked — the list row', async () => {
    const groups = await adapter.events.groups({
      sessionId: SESSION,
      kind: 'mmkv',
      countWhere: { field: 'isFinal', value: '0' },
    });

    // One snapshot and one change each: the row reads "1 change", not "2".
    expect(
      groups.map((entry) => [entry.key, entry.changeCount]).sort()
    ).toEqual([
      ['mmkv-1', 1],
      ['mmkv-2', 1],
    ]);
  });

  it('counts an instance that was only ever read as no changes at all', async () => {
    // Its snapshot row is its only row — which is exactly what an instance the app
    // reads and never writes looks like, and what one looks like after a Clear.
    await adapter.events.clear(SESSION, 'mmkv');

    const groups = await adapter.events.groups({
      sessionId: SESSION,
      kind: 'mmkv',
      countWhere: { field: 'isFinal', value: '0' },
    });

    expect(groups.map((entry) => entry.changeCount)).toEqual([0, 0]);
    // Still listed, and still dated by the snapshot that survived the clear.
    expect(groups.map((entry) => entry.count)).toEqual([1, 1]);
  });
});
