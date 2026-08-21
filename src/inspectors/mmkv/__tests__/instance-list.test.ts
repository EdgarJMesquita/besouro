/**
 * The instance list is built from rows alone — no live/archived branch, because
 * attach writes each instance's snapshot row, so an instance that is only ever read
 * still has one. What the builder has to get right is the order, which is the
 * instances' attachment order rather than their activity, because an MMKV group's
 * `lastAt` moves with every snapshot sweep. The count it is handed already excludes
 * the snapshot row (`EventGroupQuery.countWhere`); what it must not do is invent one
 * of its own.
 */

import { describe, it, expect } from '@jest/globals';

import { instanceList } from '../utils/instance-list';
import type { EventGroup } from '../../../core/database/types';
import type { MMKVEvent } from '../../../core/types';
import type { MMKVInstanceInfo } from '../store/instances';

function group(partial: Partial<EventGroup> & { key: string }): EventGroup {
  return {
    count: 0,
    // Mirrors what SQL returns when the tab names its non-change rows: a group's
    // changes, baseline (or snapshot) row excluded. Set alongside `count` per test.
    changeCount: 0,
    firstAt: 0,
    lastAt: 0,
    newest: null,
    ...partial,
  } as EventGroup;
}

function attached(
  partial: Partial<MMKVInstanceInfo> & { instanceId: string }
): MMKVInstanceInfo {
  return {
    instanceName: 'default',
    captureMode: 'patched',
    registeredAt: 1_000,
    attached: true,
    ...partial,
  };
}

describe('instanceList', () => {
  it('lists an attached instance whose snapshot never landed', () => {
    // A sweep fails inside safeCapture, silently. Rows-only would hide the instance
    // outright; it must show up empty instead.
    const list = instanceList([], [attached({ instanceId: 'mmkv-1' })]);

    expect(list).toHaveLength(1);
    expect(list[0]?.instanceName).toBe('default');
    expect(list[0]?.changeCount).toBe(0);
  });

  it('does not list an attached instance twice', () => {
    const list = instanceList(
      [group({ key: 'mmkv-1', count: 3, changeCount: 2 })],
      [attached({ instanceId: 'mmkv-1' })]
    );

    expect(list).toHaveLength(1);
    expect(list[0]?.changeCount).toBe(2);
  });

  it('shows the operations, not the rows — the snapshot is not one of them', () => {
    // Four rows: one snapshot plus three real operations. Which is which is settled
    // in SQL; the builder must take that count rather than subtract one itself.
    const list = instanceList([
      group({ key: 'mmkv-1', count: 4, changeCount: 3 }),
    ]);

    expect(list[0]?.changeCount).toBe(3);
  });

  it('reports no changes for an instance that was only ever read', () => {
    // Its snapshot row is the only one it has, and that is not an operation.
    const list = instanceList([
      group({ key: 'mmkv-1', count: 1, changeCount: 0 }),
    ]);

    expect(list[0]?.changeCount).toBe(0);
  });

  it('takes the name off the newest row', () => {
    const list = instanceList([
      group({
        key: 'mmkv-1',
        count: 3,
        changeCount: 2,
        lastAt: 1000,
        newest: { instanceName: 'settings' } as MMKVEvent,
      }),
    ]);

    expect(list[0]).toEqual({
      instanceId: 'mmkv-1',
      instanceName: 'settings',
      changeCount: 2,
      updatedAt: 1000,
    });
  });

  it('falls back to the group key when a row arrived without a name', () => {
    const list = instanceList([group({ key: 'mmkv-9' })]);

    expect(list[0]?.instanceName).toBe('mmkv-9');
  });

  it('orders instances by attachment, not by activity', () => {
    // Both snapshot rows are patched forward on every sweep, so `lastAt` says which
    // instance the sweep loop reached last — nothing the list should reorder for.
    const list = instanceList([
      group({ key: 'mmkv-2', count: 1, lastAt: 5_000 }),
      group({ key: 'mmkv-1', count: 1, lastAt: 4_999 }),
    ]);

    expect(list.map((item) => item.instanceId)).toEqual(['mmkv-1', 'mmkv-2']);
  });

  it('keeps the order across a sweep that flips the timestamps', () => {
    const first = instanceList([
      group({ key: 'mmkv-1', count: 1, lastAt: 5_000 }),
      group({ key: 'mmkv-2', count: 1, lastAt: 4_000 }),
    ]);
    const second = instanceList([
      group({ key: 'mmkv-1', count: 1, lastAt: 6_000 }),
      group({ key: 'mmkv-2', count: 1, lastAt: 7_000 }),
    ]);

    expect(second.map((item) => item.instanceId)).toEqual(
      first.map((item) => item.instanceId)
    );
  });

  it('orders the tenth instance after the second', () => {
    // Attachment order is a number, so it must not be compared as text.
    const list = instanceList([
      group({ key: 'mmkv-10', count: 1 }),
      group({ key: 'mmkv-2', count: 1 }),
    ]);

    expect(list.map((item) => item.instanceId)).toEqual(['mmkv-2', 'mmkv-10']);
  });

  it('slots an attached instance into its place in the order', () => {
    // The instance whose snapshot never landed belongs where it was declared, not
    // appended after the instances that did produce rows.
    const list = instanceList(
      [group({ key: 'mmkv-2', count: 1, lastAt: 5_000 })],
      [attached({ instanceId: 'mmkv-1', instanceName: 'default' })]
    );

    expect(list.map((item) => item.instanceId)).toEqual(['mmkv-1', 'mmkv-2']);
  });

  it('dates an attached instance by when it attached', () => {
    // 0 would render as 1970 in the row's caption.
    const list = instanceList(
      [],
      [attached({ instanceId: 'mmkv-1', registeredAt: 1_700_000_000_000 })]
    );

    expect(list[0]?.updatedAt).toBe(1_700_000_000_000);
  });
});
