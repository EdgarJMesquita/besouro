/**
 * Focusing — the subtree range and the frame the scene is drawn in.
 *
 * `subtreeRange` is the one place that trusts the capture's document order
 * instead of following `parent`, so it is worth pinning: get it wrong and focus
 * silently draws a sibling's views alongside the ones you asked for, which reads
 * as a layout surprise rather than as a bug in a range.
 */

import { describe, it, expect } from '@jest/globals';
import { frameOf, subtreeRange } from '../focus';
import type { HierarchyNode, ViewTreeSnapshot } from '../../types';

function node(
  depth: number,
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
    parent: -1,
    left: frame.left ?? 0,
    top: frame.top ?? 0,
    width: frame.width ?? 402,
    height: frame.height ?? 874,
  };
}

function snapshotOf(nodes: HierarchyNode[]): ViewTreeSnapshot {
  return { width: 402, height: 874, truncated: false, nodes };
}

describe('subtreeRange', () => {
  //  0 root
  //  1   a
  //  2     a1
  //  3       a1a
  //  4     a2
  //  5   b
  const tree = [node(0), node(1), node(2), node(3), node(2), node(1)];

  it('takes a view and every descendant, and stops at the next sibling', () => {
    expect(subtreeRange(tree, 1)).toEqual({ start: 1, end: 5 });
  });

  it('stops at a shallower node, not only at an equal one', () => {
    // `a2` at index 4 is followed by `b` at depth 1 — two levels up, not one.
    expect(subtreeRange(tree, 4)).toEqual({ start: 4, end: 5 });
  });

  it('takes a leaf as itself alone', () => {
    expect(subtreeRange(tree, 3)).toEqual({ start: 3, end: 4 });
  });

  it('runs to the end for the last branch', () => {
    expect(subtreeRange(tree, 5)).toEqual({ start: 5, end: 6 });
  });

  it('is the whole capture for the root', () => {
    expect(subtreeRange(tree, 0)).toEqual({ start: 0, end: 6 });
  });

  // Callers treat "not focused" as a range too, so it has to be a real one.
  it('is the whole capture when nothing is focused', () => {
    expect(subtreeRange(tree, null)).toEqual({ start: 0, end: 6 });
  });

  it('is the whole capture for an index that is not in the tree', () => {
    expect(subtreeRange(tree, 99)).toEqual({ start: 0, end: 6 });
    expect(subtreeRange(tree, -1)).toEqual({ start: 0, end: 6 });
  });
});

describe('frameOf', () => {
  it("is the focused view's own frame", () => {
    const snapshot = snapshotOf([
      node(0),
      node(1, { left: 16, top: 120, width: 370, height: 90 }),
    ]);
    expect(frameOf(snapshot, 1)).toEqual({
      left: 16,
      top: 120,
      width: 370,
      height: 90,
    });
  });

  it('is the screen when nothing is focused', () => {
    const snapshot = snapshotOf([node(0)]);
    expect(frameOf(snapshot, null)).toEqual({
      left: 0,
      top: 0,
      width: 402,
      height: 874,
    });
  });

  // A zero-area view would make `fit` divide by zero and blank the stage. There
  // is nothing to focus on, so focusing it shows the screen rather than nothing.
  it('falls back to the screen for a view with no area', () => {
    const snapshot = snapshotOf([node(0), node(1, { width: 0, height: 0 })]);
    expect(frameOf(snapshot, 1)).toEqual({
      left: 0,
      top: 0,
      width: 402,
      height: 874,
    });
  });
});
