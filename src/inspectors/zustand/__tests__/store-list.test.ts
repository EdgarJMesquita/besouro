/**
 * The store list is built from rows alone — no live/archived branch, because a
 * `zustand` row carries the whole state, so the newest row per store is the store's
 * current state and one query serves both kinds of session. What the builder has to
 * get right is the fallback: a store that attached but has no rows must still be
 * listed, and must not be listed twice once its rows arrive.
 */

import { describe, it, expect } from '@jest/globals';
import { storeList } from '../utils/store-list';
import type { EventGroup } from '../../../core/database/types';
import type { ZustandEvent } from '../../../core/types';
import type { ZustandStoreInfo } from '../store/stores';

function group(partial: Partial<EventGroup> & { key: string }): EventGroup {
  return {
    count: 0,
    // Mirrors what SQL returns when the tab names its non-change rows: a group's
    // changes, baseline (or snapshot) row excluded. Set alongside `count` per test.
    changeCount: 0,
    firstAt: 0,
    lastAt: 0,
    newest: null,
    latest: null,
    ...partial,
  };
}

function attached(
  partial: Partial<ZustandStoreInfo> & { storeId: string }
): ZustandStoreInfo {
  return {
    storeName: 'counter',
    registeredAt: 900,
    attached: true,
    ...partial,
  };
}

describe('storeList', () => {
  it('takes the name and timing off the grouped rows', () => {
    const list = storeList([
      group({
        key: 'zustand-1',
        count: 13,
        changeCount: 12,
        lastAt: 50,
        newest: { storeName: 'cart' } as ZustandEvent,
      }),
    ]);

    expect(list[0]).toEqual({
      storeId: 'zustand-1',
      storeName: 'cart',
      changeCount: 12,
      updatedAt: 50,
    });
  });

  it('falls back to the group key when a row arrived without a name', () => {
    expect(storeList([group({ key: 'zustand-9' })])[0]?.storeName).toBe(
      'zustand-9'
    );
  });

  it('lists an attached store whose initial capture never landed', () => {
    // `attachZustand` records `getState()` inside safeCapture, so a throw there is
    // silent. Rows-only would hide the store outright; it must show up empty.
    const list = storeList([], [attached({ storeId: 'zustand-1' })]);

    expect(list).toHaveLength(1);
    expect(list[0]?.storeName).toBe('counter');
    expect(list[0]?.changeCount).toBe(0);
    // Its registration time, not 0 — the row renders this as a clock time, and the
    // epoch reads as 1969.
    expect(list[0]?.updatedAt).toBe(900);
  });

  it('does not list an attached store twice', () => {
    const list = storeList(
      [group({ key: 'zustand-1', count: 4, changeCount: 3 })],
      [attached({ storeId: 'zustand-1' })]
    );

    expect(list).toHaveLength(1);
    expect(list[0]?.changeCount).toBe(3);
  });

  it('shows the changes, not the rows — the baseline is not one of them', () => {
    // A store subscribed and never touched has a row (where it started) and no
    // change, and the list has to say so. Which rows are changes is settled in SQL,
    // where a reload's second baseline is discounted too; the builder takes the
    // count it is given rather than subtracting a fixed one.
    expect(
      storeList([group({ key: 'zustand-1', count: 5, changeCount: 4 })])[0]
        ?.changeCount
    ).toBe(4);
  });

  it('orders stores by attachment, not by which changed last', () => {
    // The stores are declared once in the config, so this list is an inventory rather
    // than a feed: a row must not move because some *other* store changed.
    const list = storeList([
      group({ key: 'zustand-2', count: 1, lastAt: 5_000 }),
      group({ key: 'zustand-1', count: 1, lastAt: 4_000 }),
    ]);

    expect(list.map((item) => item.storeId)).toEqual([
      'zustand-1',
      'zustand-2',
    ]);
  });

  it('holds its order when a later change flips the timestamps', () => {
    const before = storeList([
      group({ key: 'zustand-1', count: 1, lastAt: 5_000 }),
      group({ key: 'zustand-2', count: 1, lastAt: 4_000 }),
    ]);
    const after = storeList([
      group({ key: 'zustand-2', count: 2, lastAt: 9_000 }),
      group({ key: 'zustand-1', count: 1, lastAt: 5_000 }),
    ]);

    expect(after.map((item) => item.storeId)).toEqual(
      before.map((item) => item.storeId)
    );
  });

  it('slots an attached store into its place in the order', () => {
    // The store whose initial capture never landed belongs where it was declared,
    // not appended after the stores that did produce rows.
    const list = storeList(
      [group({ key: 'zustand-2', count: 1, lastAt: 5_000 })],
      [attached({ storeId: 'zustand-1' })]
    );

    expect(list.map((item) => item.storeId)).toEqual([
      'zustand-1',
      'zustand-2',
    ]);
  });

  it('describes a past session from its rows, with no attachment fallback', () => {
    // The tab passes an empty attachment list when viewing a past session: those
    // stores belong to this launch, and right after a reload every one of them is
    // back at its initial state — plausible, and a different run.
    expect(storeList([], [])).toEqual([]);
  });
});
