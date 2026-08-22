import { describe, expect, it } from '@jest/globals';

import { propPreview } from '../utils/preview';

describe('propPreview', () => {
  it('renders primitives the way a row reads them', () => {
    expect(propPreview('hello')).toBe('hello');
    expect(propPreview(42)).toBe('42');
    expect(propPreview(null)).toBe('null');
    expect(propPreview(undefined)).toBe('undefined');
    expect(propPreview(() => {})).toBe('ƒ');
  });

  it('renders a React element as its tag, without entering it', () => {
    const child = {
      $$typeof: Symbol.for('react.transitional.element'),
      type: 'RCTText',
      props: {},
    };
    expect(propPreview(child)).toBe('<RCTText />');
  });

  it('names composite and legacy elements', () => {
    function ProfileCard() {}
    expect(
      propPreview({
        $$typeof: Symbol.for('react.element'),
        type: ProfileCard,
      })
    ).toBe('<ProfileCard />');
  });

  /**
   * The regression this module exists for: `children` holds an element whose
   * `_owner` is a fiber, and a fiber is cyclic and reaches the whole tree.
   * Stringifying it is what made an edit take seconds.
   */
  it('does not walk the fiber hanging off an element', () => {
    const fiber: Record<string, unknown> = { tag: 5, memoizedProps: {} };
    fiber.return = fiber;
    fiber.child = fiber;
    const element = {
      $$typeof: Symbol.for('react.transitional.element'),
      type: 'RCTView',
      props: { children: 'deep' },
      _owner: fiber,
    };
    expect(propPreview(element)).toBe('<RCTView />');
  });

  it('caps depth rather than descending an arbitrary graph', () => {
    expect(propPreview({ a: { b: { c: { d: 1 } } } })).toBe('{a: {b: {…}}}');
  });

  it('caps the entries shown per level', () => {
    const wide = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`k${i}`, i])
    );
    expect(propPreview(wide)).toBe(
      '{k0: 0, k1: 1, k2: 2, k3: 3, k4: 4, k5: 5, …+3}'
    );
  });

  it('survives a cycle in a plain object', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(propPreview(cyclic)).toBe(
      '{name: "root", self: {name: "root", self: {…}}}'
    );
  });

  it('describes types JSON would flatten to {}', () => {
    expect(propPreview(new Map([['a', 1]]))).toBe('Map(1)');
    expect(propPreview(new Set([1, 2]))).toBe('Set(2)');
    expect(propPreview(new Error('boom'))).toBe('Error: boom');
  });

  it('clips a long result', () => {
    const long = propPreview({ text: 'x'.repeat(400) });
    expect(long).toHaveLength(141);
    expect(long.endsWith('…')).toBe(true);
  });
});
