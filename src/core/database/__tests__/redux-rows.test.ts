/**
 * Redux rows against a real SQLite engine.
 *
 * The Redux inspector is the only one that *patches* a row on a repeating timer —
 * the closing snapshot is written once and refreshed in place — so its round trip
 * gets its own coverage: an insert, an update, the equality filter the archived
 * State view finds it with, and the heavy-column fetch that renders it.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDatabase } from '../sqlite-database';
import { createNodeDatabase, type NodeDatabase } from './node-database';
import type { Database } from '../types';
import type { ReduxEvent, SessionMeta } from '../../types';

const SESSION = 'session-redux';

let database: NodeDatabase;
let adapter: Database;

beforeEach(async () => {
  database = createNodeDatabase();
  adapter = openDatabase(database);
  await adapter.ready();
  await adapter.sessions.save({
    id: SESSION,
    startedAt: 1,
    status: 'open',
    inspectors: ['redux'],
  } as SessionMeta);
});

afterEach(() => {
  database.close();
});

function reduxEvent(
  id: string,
  timestamp: number,
  overrides: Partial<ReduxEvent> = {}
): ReduxEvent {
  return {
    id,
    sessionId: SESSION,
    timestamp,
    kind: 'redux',
    actionType: 'cart/addItem',
    isInitial: false,
    isReload: false,
    isFinal: false,
    changedKeys: ['cart'],
    changedPaths: ['cart.items'],
    payload: '{"sku":"A1"}',
    payloadTruncated: false,
    changedState: '{"cart":{"items":["A1"]}}',
    changedStateTruncated: false,
    stateIsFull: false,
    ...overrides,
  };
}

describe('redux rows', () => {
  it('round-trips an action row', async () => {
    await adapter.events.commit({
      inserts: [reduxEvent('a', 10)],
      updates: [],
    });

    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'redux',
      limit: 10,
    });
    const row = page.rows[0] as ReduxEvent;
    expect(row.actionType).toBe('cart/addItem');
    expect(row.changedKeys).toEqual(['cart']);
    expect(row.isFinal).toBe(false);
    expect(row.stateIsFull).toBe(false);
  });

  it('patches the closing snapshot in place, timestamp included', async () => {
    await adapter.events.commit({
      inserts: [
        reduxEvent('final', 10, {
          actionType: '@@besouro/FINAL_STATE',
          isFinal: true,
          stateIsFull: true,
          payload: undefined,
          changedState: '{"cart":{}}',
        }),
      ],
      updates: [],
    });

    await adapter.events.commit({
      inserts: [],
      updates: [
        {
          id: 'final',
          kind: 'redux',
          patch: {
            timestamp: 99,
            changedState: '{"cart":{"items":["B2"]}}',
            changedStateTruncated: false,
          } as Partial<ReduxEvent>,
        },
      ],
    });

    const loaded = (await adapter.events.load('redux', 'final')) as ReduxEvent;
    expect(loaded.timestamp).toBe(99);
    expect(loaded.changedState).toContain('B2');
    expect(loaded.isFinal).toBe(true);
  });

  it('excludes the closing snapshot from the action log', async () => {
    // The log filters it out in SQL rather than dropping it from a loaded page, so
    // a page of N rows never renders as N-1 — and in a live session the snapshot
    // (re-timestamped on every refresh) would otherwise sit pinned to the top.
    await adapter.events.commit({
      inserts: [
        reduxEvent('a', 10),
        reduxEvent('final', 20, { isFinal: true, stateIsFull: true }),
      ],
      updates: [],
    });

    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'redux',
      limit: 10,
      where: { field: 'isFinal', value: '0' },
    });
    expect(page.rows.map((row) => row.id)).toEqual(['a']);
  });

  it('finds the closing snapshot by the isFinal filter', async () => {
    await adapter.events.commit({
      inserts: [
        reduxEvent('a', 10),
        reduxEvent('final', 20, { isFinal: true, stateIsFull: true }),
      ],
      updates: [],
    });

    const page = await adapter.events.query({
      sessionId: SESSION,
      kind: 'redux',
      limit: 10,
      where: { field: 'isFinal', value: '1' },
    });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]?.id).toBe('final');
  });
});
