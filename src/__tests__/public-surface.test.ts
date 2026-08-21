/**
 * What the published entry point exposes.
 *
 * `Besouro` is a facade over the controller, not the controller itself. The
 * controller carries accessors the drawer reads through (`getOptions`,
 * `getInspectors`, `getDatabase`); none of them are a consumer's business, and a
 * type annotation alone would leave them callable at runtime.
 *
 * So this asserts the runtime shape, not the types: returning the instance from
 * `../index` would still typecheck against `BesouroBuilder` and would still
 * fail here.
 */

import { describe, it, expect } from '@jest/globals';

import { Besouro } from '..';

const PUBLIC_METHODS = [
  'configure',
  'setAsyncStorageHandler',
  'setMMKVInstances',
  'setZustandStores',
  'setReduxStore',
  'setJotaiAtoms',
  'setSocketIOManager',
  'setNotificationsHandlers',
  'init',
];

/** Reachable through the controller, and deliberately not through the facade. */
const INTERNAL_METHODS = ['getOptions', 'getInspectors', 'getDatabase'];

describe('public surface', () => {
  it('exposes exactly the builder methods', () => {
    expect(Object.keys(Besouro).sort()).toEqual([...PUBLIC_METHODS].sort());
  });

  it('does not carry the controller accessors', () => {
    for (const name of INTERNAL_METHODS) {
      expect(Besouro[name as keyof typeof Besouro]).toBeUndefined();
    }
  });

  it('chains: every builder method but init returns the builder', () => {
    for (const name of PUBLIC_METHODS.filter((m) => m !== 'init')) {
      // `configure` is the only one safe to call with no argument — the setters
      // would install real patches — so chaining is asserted through it, and the
      // rest are checked structurally.
      expect(typeof Besouro[name as keyof typeof Besouro]).toBe('function');
    }
    expect(Besouro.configure()).toBe(Besouro);
  });
});
