/**
 * The change flash keys off these strings, so what matters is that they are the
 * paths `JsonViewer` puts on its lines — `flatten.ts` builds them, and the two must
 * agree exactly or nothing ever flashes. The last test pins that agreement by
 * flattening the same document and intersecting.
 */

import { describe, it, expect } from '@jest/globals';

import { changedPaths, MAX_CHANGED_PATHS } from '../utils/changed-paths';
import { flattenJson } from '../../../shared/components/JsonViewer/flatten';

describe('changedPaths', () => {
  it('reports nothing for the same reference', () => {
    const state = { a: 1 };
    expect(changedPaths(state, state)).toEqual([]);
  });

  it('names a changed leaf by its dotted path', () => {
    expect(
      changedPaths({ cart: { total: 1 } }, { cart: { total: 2 } })
    ).toEqual(['cart.total']);
  });

  it('skips subtrees that kept their reference', () => {
    const auth = { user: 'ada' };
    expect(
      changedPaths({ auth, cart: { n: 1 } }, { auth, cart: { n: 2 } })
    ).toEqual(['cart.n']);
  });

  it('reports added and removed keys', () => {
    expect(changedPaths({ a: 1 }, { a: 1, b: 2 })).toEqual(['b']);
    expect(changedPaths({ a: 1, b: 2 }, { a: 1 })).toEqual(['b']);
  });

  it('indexes into arrays of equal length', () => {
    expect(changedPaths({ xs: [1, 2, 3] }, { xs: [1, 9, 3] })).toEqual([
      'xs[1]',
    ]);
  });

  it('flashes the array itself when its length changed', () => {
    // Index-wise diffing a resized array reports the whole tail and means nothing.
    expect(changedPaths({ xs: [1, 2] }, { xs: [1, 2, 3] })).toEqual(['xs']);
  });

  it('stops descending when a value changes type', () => {
    expect(changedPaths({ a: { b: 1 } }, { a: 'gone' })).toEqual(['a']);
  });

  it('names the root when the root itself changed kind', () => {
    expect(changedPaths({ a: 1 }, [1])).toEqual(['']);
  });

  it('caps how many paths it will report', () => {
    const size = MAX_CHANGED_PATHS * 2;
    const prev: Record<string, number> = {};
    const next: Record<string, number> = {};
    for (let index = 0; index < size; index += 1) {
      prev[`k${index}`] = 0;
      next[`k${index}`] = 1;
    }
    expect(changedPaths(prev, next)).toHaveLength(MAX_CHANGED_PATHS);
  });

  it('emits paths that exist on the viewer’s flattened lines', () => {
    const prev = { cart: { items: [{ sku: 'A' }] }, auth: { user: null } };
    const next = { cart: { items: [{ sku: 'B' }] }, auth: { user: null } };

    const paths = changedPaths(prev, next);
    expect(paths).toEqual(['cart.items[0].sku']);

    const linePaths = new Set(flattenJson(next).map((line) => line.path));
    for (const path of paths) {
      expect(linePaths.has(path)).toBe(true);
    }
  });
});
