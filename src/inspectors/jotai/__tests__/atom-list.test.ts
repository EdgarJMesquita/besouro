/**
 * The atom list is built from rows alone — no live/archived branch, because a `jotai`
 * row carries the whole value and its preview, so the newest row per atom is the
 * atom's current value and one query serves both kinds of session. What the builder
 * has to get right is the fallback: an atom that was subscribed but has no rows must
 * still be listed, and must not be listed twice once its rows arrive.
 */

import { describe, it, expect } from '@jest/globals';
import { atomList } from '../utils/atom-list';
import type { EventGroup } from '../../../core/database/types';
import type { JotaiEvent } from '../../../core/types';
import type { JotaiAtomInfo } from '../store/atoms';

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
  partial: Partial<JotaiAtomInfo> & { atomId: string }
): JotaiAtomInfo {
  return { atomName: 'cart', registeredAt: 900, attached: true, ...partial };
}

describe('atomList', () => {
  it('takes the name, preview and timing off the grouped rows', () => {
    const list = atomList([
      group({
        key: 'jotai-1',
        count: 8,
        changeCount: 7,
        lastAt: 50,
        newest: {
          atomName: 'cart',
          preview: '{"items":["SKU-9"],"total":90}',
        } as JotaiEvent,
      }),
    ]);

    expect(list[0]).toEqual({
      atomId: 'jotai-1',
      atomName: 'cart',
      preview: '{"items":["SKU-9"],"total":90}',
      changeCount: 7,
      updatedAt: 50,
    });
  });

  it('falls back to the group key when a row arrived without a name', () => {
    const [item] = atomList([group({ key: 'jotai-9' })]);
    expect(item?.atomName).toBe('jotai-9');
    expect(item?.preview).toBe('');
  });

  it('lists a subscribed atom whose initial capture never landed', () => {
    // The first `get` runs inside safeCapture, so a throw there is silent.
    // Rows-only would hide the atom outright; it must show up empty.
    const list = atomList([], [attached({ atomId: 'jotai-1' })]);

    expect(list).toHaveLength(1);
    expect(list[0]?.atomName).toBe('cart');
    expect(list[0]?.changeCount).toBe(0);
    expect(list[0]?.preview).toBe('');
    // Its registration time, not 0 — the row renders this as a clock time, and the
    // epoch reads as 1969.
    expect(list[0]?.updatedAt).toBe(900);
  });

  it('does not list a subscribed atom twice', () => {
    const list = atomList(
      [group({ key: 'jotai-1', count: 4, changeCount: 3 })],
      [attached({ atomId: 'jotai-1' })]
    );

    expect(list).toHaveLength(1);
    expect(list[0]?.changeCount).toBe(3);
  });

  it('orders atoms by subscription, not by which changed last', () => {
    // The atoms are declared once in the config, so this list is an inventory rather
    // than a feed: a row must not move because some *other* atom changed.
    const list = atomList([
      group({ key: 'jotai-2', count: 1, lastAt: 5_000 }),
      group({ key: 'jotai-1', count: 1, lastAt: 4_000 }),
    ]);

    expect(list.map((item) => item.atomId)).toEqual(['jotai-1', 'jotai-2']);
  });

  it('holds its order when a later change flips the timestamps', () => {
    const before = atomList([
      group({ key: 'jotai-1', count: 1, lastAt: 5_000 }),
      group({ key: 'jotai-2', count: 1, lastAt: 4_000 }),
    ]);
    const after = atomList([
      group({ key: 'jotai-2', count: 2, lastAt: 9_000 }),
      group({ key: 'jotai-1', count: 1, lastAt: 5_000 }),
    ]);

    expect(after.map((item) => item.atomId)).toEqual(
      before.map((item) => item.atomId)
    );
  });

  it('slots a subscribed atom into its place in the order', () => {
    // The atom whose initial capture never landed belongs where it was declared, not
    // appended after the atoms that did produce rows.
    const list = atomList(
      [group({ key: 'jotai-2', count: 1, lastAt: 5_000 })],
      [attached({ atomId: 'jotai-1' })]
    );

    expect(list.map((item) => item.atomId)).toEqual(['jotai-1', 'jotai-2']);
  });

  it('describes a past session from its rows, with no attachment fallback', () => {
    // The tab passes an empty attachment list when viewing a past session: those
    // atoms belong to this launch, and right after a reload every one of them is
    // back at its initial value — plausible, and a different run.
    expect(atomList([], [])).toEqual([]);
  });
});
