/**
 * The user's tab order is the one preference read back out of a file the user can
 * outlive: an inspector they moved may be switched off in the next build, or gone
 * from the library entirely. So the rules that matter here are the degrading ones —
 * a saved order must never be able to duplicate, ghost, or drop a tab.
 *
 * The gesture that produces it isn't covered: this suite runs in a plain node
 * environment with no React Native renderer (see jest.config.js).
 */

import { describe, it, expect } from '@jest/globals';
import { moveInspector, orderInspectors } from '../tab-order';
import { INSPECTOR_ORDER } from '../types';
import type { Inspector } from '../types';

const ENABLED: Inspector[] = ['network', 'console', 'websocket', 'element'];

describe('orderInspectors', () => {
  it('falls back to the library order when nothing is saved', () => {
    expect(orderInspectors(ENABLED, null)).toEqual([
      'network',
      'console',
      'websocket',
      'element',
    ]);
  });

  it('honours a saved order', () => {
    expect(
      orderInspectors(ENABLED, ['element', 'websocket', 'console', 'network'])
    ).toEqual(['element', 'websocket', 'console', 'network']);
  });

  it('appends enabled inspectors the saved order never mentioned', () => {
    // A newly enabled — or newly shipped — inspector joins the end in
    // INSPECTOR_ORDER, rather than appearing in the middle of a strip the user
    // arranged.
    expect(orderInspectors(ENABLED, ['element'])).toEqual([
      'element',
      'network',
      'console',
      'websocket',
    ]);
  });

  it('ignores saved entries that are not enabled', () => {
    expect(
      orderInspectors(['network', 'console'], ['zustand', 'console'])
    ).toEqual(['console', 'network']);
  });

  it('renders a repeated entry once', () => {
    expect(orderInspectors(ENABLED, ['console', 'console', 'network'])).toEqual(
      ['console', 'network', 'websocket', 'element']
    );
  });

  it('ignores ids it does not recognise', () => {
    // A file from a version that had an inspector this one doesn't. Deliberately
    // an id no version ever shipped: a real-but-disabled inspector is the case
    // above, and reusing one here would test that path twice and this one never.
    expect(orderInspectors(ENABLED, ['flipper', 'console'])).toEqual([
      'console',
      'network',
      'websocket',
      'element',
    ]);
  });

  it('falls back to the library order for a value that is not an array', () => {
    // Corrupt or hand-edited settings file.
    for (const saved of ['console', 42, {}, undefined]) {
      expect(orderInspectors(ENABLED, saved)).toEqual(ENABLED);
    }
  });

  it('keeps every enabled inspector, whatever the saved value', () => {
    const enabled = [...INSPECTOR_ORDER];
    const ordered = orderInspectors(enabled, [
      'fileSystem',
      'fileSystem',
      'nope',
    ]);
    expect([...ordered].sort()).toEqual([...enabled].sort());
    expect(ordered).toHaveLength(enabled.length);
  });
});

describe('moveInspector', () => {
  it('moves an entry later', () => {
    expect(moveInspector(ENABLED, 0, 2)).toEqual([
      'console',
      'websocket',
      'network',
      'element',
    ]);
  });

  it('moves an entry earlier', () => {
    expect(moveInspector(ENABLED, 3, 1)).toEqual([
      'network',
      'element',
      'console',
      'websocket',
    ]);
  });

  it('leaves the list alone when the move goes nowhere', () => {
    // A drop resolving to its own slot, or to an index that no longer exists,
    // reaches this rather than being guarded at the call site.
    expect(moveInspector(ENABLED, 2, 2)).toEqual(ENABLED);
    expect(moveInspector(ENABLED, -1, 1)).toEqual(ENABLED);
    expect(moveInspector(ENABLED, 1, 9)).toEqual(ENABLED);
  });

  it('does not mutate the list it was given', () => {
    const original: Inspector[] = [...ENABLED];
    moveInspector(original, 0, 3);
    expect(original).toEqual(ENABLED);
  });
});
