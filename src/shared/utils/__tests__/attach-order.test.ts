/**
 * The order shared by the three declared-set tabs. The per-tab builders each pin the
 * behaviour they depend on; what is pinned here is the comparator itself, including
 * the ids it cannot place.
 */

import { describe, it, expect } from '@jest/globals';

import { byAttachOrder } from '../attach-order';

interface Item {
  id: string;
  name: string;
}

const compare = byAttachOrder<Item>(
  (item) => item.id,
  (item) => item.name
);

function order(...ids: string[]): string[] {
  return ids
    .map((id) => ({ id, name: id }))
    .sort(compare)
    .map((item) => item.id);
}

describe('byAttachOrder', () => {
  it('orders by the counter the interceptor minted, not by id text', () => {
    // Compared as text, the tenth store sorts between the first and the second.
    expect(order('zustand-10', 'zustand-2', 'zustand-1')).toEqual([
      'zustand-1',
      'zustand-2',
      'zustand-10',
    ]);
  });

  it('works for every kind that mints ids this way', () => {
    expect(order('jotai-3', 'jotai-1')).toEqual(['jotai-1', 'jotai-3']);
    expect(order('mmkv-3', 'mmkv-1')).toEqual(['mmkv-1', 'mmkv-3']);
  });

  it('sorts an id it cannot place last, rather than first', () => {
    // `Number('')` is 0 and `Number(undefined)` is NaN; only one of those is caught
    // by a finiteness check, so both shapes are pinned.
    expect(order('zustand-2', 'legacy', 'zustand-')).toEqual([
      'zustand-2',
      'legacy',
      'zustand-',
    ]);
  });

  it('breaks a tie among unplaceable ids by name, so they cannot shuffle', () => {
    const items = [
      { id: 'x', name: 'settings' },
      { id: 'y', name: 'cart' },
    ];

    expect([...items].sort(compare).map((item) => item.name)).toEqual([
      'cart',
      'settings',
    ]);
  });
});
