/**
 * Plane assignment — the rule that stops two views sharing a sheet.
 *
 * Worth testing rather than eyeballing: a mistake here doesn't crash, it draws
 * two rectangles on top of each other and looks like a rendering bug, which is
 * exactly the wrong place to go looking for it.
 */

import { describe, it, expect } from '@jest/globals';
import { assignPlanes, lastPlane, planeDepth } from '../planes';
import type { HierarchyNode } from '../types';

function node(
  depth: number,
  parent: number,
  frame: Partial<Pick<HierarchyNode, 'left' | 'top' | 'width' | 'height'>> = {}
): HierarchyNode {
  return {
    tag: 0,
    className: 'V',
    testID: '',
    text: '',
    textSize: 0,
    textAlign: '',
    radius: 0,
    fragment: '',
    depth,
    parent,
    left: frame.left ?? 0,
    top: frame.top ?? 0,
    width: frame.width ?? 402,
    height: frame.height ?? 874,
  };
}

describe('assignPlanes', () => {
  it('puts each view exactly one plane in front of its parent', () => {
    const planes = assignPlanes([
      node(0, -1),
      node(1, 0, { width: 100, height: 50 }),
      node(2, 1, { width: 80, height: 40 }),
    ]);
    expect(planes).toEqual([0, 1, 2]);
  });

  it('pushes a view off a rectangle already taken on its plane', () => {
    // Two sibling subtrees, both full-screen at 0,0 — the app's branch and a
    // tool's branch mounted beside it.
    const planes = assignPlanes([node(0, -1), node(1, 0), node(1, 0)]);
    expect(planes).toEqual([0, 1, 2]);
  });

  it('keeps pushing while it keeps colliding', () => {
    // A branch that shadows its sibling for several levels collides at its own
    // plane and again at the next before finding clear space.
    const planes = assignPlanes([
      node(0, -1),
      node(1, 0),
      node(2, 1),
      node(1, 0), // collides at 1, then at 2 → 3
    ]);
    expect(planes).toEqual([0, 1, 2, 3]);
  });

  it('carries a pushed view’s descendants along with it', () => {
    // The reason planes derive from the parent rather than from depth: a child
    // follows its parent's push for free, and can never land on it.
    const planes = assignPlanes([
      node(0, -1),
      node(1, 0), // branch A
      node(1, 0), // branch B — collides with A, pushed to 2
      node(2, 2, { width: 10, height: 10 }), // B's child → 3
    ]);
    expect(planes).toEqual([0, 1, 2, 3]);
    expect(planes[3]!).toBeGreaterThan(planes[2]!);
  });

  it('leaves branches alone that did not collide', () => {
    // What deriving from the parent buys over a global offset: pushing one branch
    // no longer shifts every view after it, so the stack stays as shallow as the
    // screen requires.
    const planes = assignPlanes([
      node(0, -1),
      node(1, 0), // A
      node(1, 0), // B — pushed to 2
      // C overhangs the others rather than sitting inside them, so it collides
      // with nothing and keeps its plane.
      node(1, 0, { left: 380, top: 860, width: 100, height: 100 }),
    ]);
    expect(planes).toEqual([0, 1, 2, 1]);
  });

  it('separates siblings React Native flattened into one level', () => {
    // `<View><View><Text>` with a background on each comes back as three children
    // of the same parent — nested in geometry, flat in structure. Placed by
    // parentage alone all three share a sheet and only the innermost is visible.
    const planes = assignPlanes([
      node(0, -1),
      node(1, 0, { left: 125, top: 751, width: 162, height: 99 }),
      node(1, 0, { left: 151, top: 773, width: 109, height: 59 }),
      node(1, 0, { left: 165, top: 787, width: 82, height: 32 }),
    ]);
    expect(planes).toEqual([0, 1, 2, 3]);
  });

  it('leaves views that merely overlap on the same plane', () => {
    // Crossing at a corner reads fine on one sheet. Only containment hides a view
    // behind the thing it sits inside, and only that is worth a plane.
    const planes = assignPlanes([
      node(0, -1),
      node(1, 0, { left: 0, top: 0, width: 100, height: 100 }),
      node(1, 0, { left: 60, top: 60, width: 100, height: 100 }),
    ]);
    expect(planes).toEqual([0, 1, 1]);
  });

  it('leaves same-size views at different positions alone', () => {
    // They do not overlap, so separating them would spend a plane on nothing.
    const planes = assignPlanes([
      node(0, -1),
      node(1, 0, { top: 0, width: 100, height: 50 }),
      node(1, 0, { top: 60, width: 100, height: 50 }),
    ]);
    expect(planes).toEqual([0, 1, 1]);
  });

  it('treats sub-pixel differences as the same rectangle', () => {
    // Frames arrive with float noise; 37.666664 and 37.666671 are one rectangle.
    const planes = assignPlanes([
      node(0, -1, { height: 37.666664123535156 }),
      node(1, 0, { height: 37.666671752929688 }),
    ]);
    expect(planes).toEqual([0, 1]);
  });

  it('falls back to depth for a node with no usable parent', () => {
    // A payload from a native build older than `parent`, once the parse has done
    // what it can — the node still has to land somewhere sensible.
    expect(assignPlanes([node(2, -1)])).toEqual([2]);
  });
});

describe('lastPlane', () => {
  it('reports the deepest plane, not the deepest depth', () => {
    expect(lastPlane(assignPlanes([node(0, -1), node(1, 0), node(1, 0)]))).toBe(
      2
    );
  });

  it('is 0 for an empty capture', () => {
    expect(lastPlane([])).toBe(0);
  });
});

describe('planeDepth', () => {
  // Nested frames, so each view is pushed a plane in front of the last.
  const nodes = [
    node(0, -1),
    node(1, 0, { width: 300, height: 300 }),
    node(2, 1, { width: 200, height: 200 }),
    node(3, 2, { width: 100, height: 100 }),
  ];
  const planes = assignPlanes(nodes);

  it('counts the whole capture from plane zero', () => {
    expect(planeDepth(nodes, planes, 0, nodes.length)).toBe(3);
  });

  // A focused subtree is redrawn from its own root, so its depth is relative —
  // otherwise the control would open with most of its range already spent.
  it('counts a slice from its own first plane', () => {
    expect(planeDepth(nodes, planes, 2, nodes.length)).toBe(1);
  });

  it('is 0 for a single view', () => {
    expect(planeDepth(nodes, planes, 3, 4)).toBe(0);
  });

  // The stack skips these, so counting them would put a notch on the control
  // that draws nothing.
  it('ignores views with no area', () => {
    const withEmpty = [
      node(0, -1),
      node(1, 0, { width: 300, height: 300 }),
      node(2, 1, { width: 0, height: 0 }),
    ];
    expect(
      planeDepth(withEmpty, assignPlanes(withEmpty), 0, withEmpty.length)
    ).toBe(1);
  });

  it('is 0 for an empty capture', () => {
    expect(planeDepth([], [], 0, 0)).toBe(0);
  });
});
