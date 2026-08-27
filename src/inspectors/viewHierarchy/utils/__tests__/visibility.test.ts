/**
 * Which captured views the stack can actually show — see `../visibility`.
 */

import { describe, it, expect } from '@jest/globals';
import { isOnScreen } from '../visibility';
import type { HierarchyNode, ViewTreeSnapshot } from '../../types';

const screen: ViewTreeSnapshot = {
  width: 402,
  height: 874,
  truncated: false,
  nodes: [],
};

function node(frame: Partial<HierarchyNode>): HierarchyNode {
  return {
    tag: 0,
    className: 'V',
    testID: '',
    text: '',
    textSize: 0,
    textAlign: '',
    radius: 0,
    fragment: '',
    depth: 0,
    parent: -1,
    left: 0,
    top: 0,
    width: 100,
    height: 50,
    ...frame,
  };
}

describe('isOnScreen', () => {
  it('accepts a view inside the screen', () => {
    expect(isOnScreen(node({ left: 10, top: 10 }), screen)).toBe(true);
  });

  it('rejects a view scrolled clean off the top', () => {
    // The shape that prompted this: a title at `top: -489` on an 874dp screen.
    expect(isOnScreen(node({ top: -489, height: 21 }), screen)).toBe(false);
  });

  it('rejects a view below the fold', () => {
    expect(isOnScreen(node({ top: 1349 }), screen)).toBe(false);
  });

  it('accepts a view only half off the edge', () => {
    // Still in the picture, still worth pointing at.
    expect(isOnScreen(node({ top: -20, height: 50 }), screen)).toBe(true);
    expect(isOnScreen(node({ left: -40, width: 100 }), screen)).toBe(true);
  });

  it('rejects a view with no area, wherever it sits', () => {
    expect(isOnScreen(node({ width: 0 }), screen)).toBe(false);
    expect(isOnScreen(node({ height: 0 }), screen)).toBe(false);
  });
});
