/**
 * Dropping development tooling from a capture.
 *
 * Both rules delete things, which is the kind of filter worth pinning down: too
 * greedy and it silently removes the app's own UI, too shy and the stack carries
 * blank full-screen sheets that belong to a tool.
 */

import { describe, it, expect } from '@jest/globals';
import { withoutDevTooling } from '../dev-tooling';
import type { HierarchyNode } from '../../types';

function node(
  depth: number,
  className: string,
  tag = 0,
  extra: Partial<HierarchyNode> = {}
): HierarchyNode {
  return {
    tag,
    className,
    testID: '',
    text: '',
    textSize: 0,
    textAlign: '',
    radius: 0,
    fragment: '',
    depth,
    parent: -1,
    left: 0,
    top: 0,
    width: 402,
    height: 874,
    ...extra,
  };
}

const names = (nodes: HierarchyNode[]) => nodes.map((n) => n.className);

describe('withoutDevTooling', () => {
  it('drops the debugging overlay and the container hosting it', () => {
    // The host is a plain `RCTViewComponentView` — nothing in its name marks it,
    // so it has to be caught structurally, by being left with no kept children.
    expect(
      names(
        withoutDevTooling([
          node(0, 'Root', 1),
          node(1, 'ReactSurfaceView', 1),
          node(1, 'RCTViewComponentView', 292),
          node(2, 'RCTDebuggingOverlayComponentView', 290),
          node(3, 'RCTDebuggingOverlay'),
        ])
      )
    ).toEqual(['Root', 'ReactSurfaceView']);
  });

  it('drops the Expo dev bubble, by the tag its fragment was added under', () => {
    // `DevMenuFragment.onCreateView` returns a bare LinearLayout holding a bare
    // ComposeView. Neither class name distinguishes it from Compose the app
    // renders; `DevMenuFragment.TAG` does, exactly.
    expect(
      names(
        withoutDevTooling([
          node(0, 'Root', 1),
          node(1, 'ReactSurfaceView', 1),
          node(2, 'ReactViewGroup', 220),
          node(1, 'LinearLayout', 0, { fragment: 'ExpoDevMenuFragment' }),
          node(2, 'ComposeView'),
          node(3, 'AndroidComposeView'),
        ])
      )
    ).toEqual(['Root', 'ReactSurfaceView', 'ReactViewGroup']);
  });

  // The requirement that ruled out matching the bubble by class name: the app's
  // own Compose reports the very same names, and only the stacking order tells
  // the two apart.
  it('keeps Compose the app renders itself', () => {
    expect(
      names(
        withoutDevTooling([
          node(0, 'Root', 1),
          node(1, 'ReactSurfaceView', 1),
          node(2, 'ReactViewGroup', 220),
          node(3, 'ReactTextView', 221, { text: 'Hello' }),
          node(3, 'ComposeView'),
          node(4, 'AndroidComposeView'),
        ])
      )
    ).toEqual([
      'Root',
      'ReactSurfaceView',
      'ReactViewGroup',
      'ReactTextView',
      'ComposeView',
      'AndroidComposeView',
    ]);
  });

  it('keeps a container that still has a child of its own', () => {
    expect(
      names(
        withoutDevTooling([
          node(0, 'Root', 1),
          node(1, 'ReactViewGroup', 10),
          node(2, 'RCTDebuggingOverlay'),
          node(2, 'ReactTextView', 12),
        ])
      )
    ).toEqual(['Root', 'ReactViewGroup', 'ReactTextView']);
  });

  it('keeps a childless view that shows something', () => {
    // The empty-container rule must not eat leaves — a text or a testID is
    // content, not an empty wrapper.
    expect(
      names(
        withoutDevTooling([
          node(0, 'Root', 1),
          node(1, 'ReactTextView', 12, { text: 'hi' }),
        ])
      )
    ).toEqual(['Root', 'ReactTextView']);
  });

  it('leaves an ordinary capture untouched', () => {
    const tree = [
      node(0, 'Root', 1),
      node(1, 'ReactSurfaceView', 1),
      node(2, 'ReactScrollView', 222),
      node(3, 'ReactTextView', 4, { text: 'besouro' }),
    ];
    expect(withoutDevTooling(tree)).toEqual(tree);
  });
});

/**
 * Filtering renumbers the array, and `parent` is an index into it.
 *
 * The bug this pins: nothing downstream errors on a stale `parent`. `assignPlanes`
 * guards with `parent < index`, so a pointer left over from before the filter
 * either reads another node's plane or falls through to `node.depth` — the path
 * for payloads too old to carry `parent` at all. Both are silent, and the second
 * gives up the one thing `parent` exists for: placing views React Native has
 * flattened into siblings.
 */
describe('withoutDevTooling and parent indices', () => {
  it('repoints parent at the surviving nodes', () => {
    const kept = withoutDevTooling([
      node(0, 'Root', 1),
      node(1, 'DebuggingOverlay', 0, { parent: 0 }),
      node(1, 'A', 2, { parent: 0 }),
      node(2, 'B', 3, { parent: 2 }),
    ]);
    expect(names(kept)).toEqual(['Root', 'A', 'B']);
    // Without the repointing `B` keeps parent 2 and now points at itself.
    expect(kept.map((n) => n.parent)).toEqual([-1, 0, 1]);
  });

  it('keeps every parent pointing at the node it named', () => {
    const kept = withoutDevTooling([
      node(0, 'Root', 1),
      node(1, 'DebuggingOverlay', 0, { parent: 0 }),
      node(1, 'Column', 2, { parent: 0 }),
      node(2, 'Row', 3, { parent: 2 }),
      node(3, 'Label', 4, { parent: 3 }),
      node(1, 'Footer', 5, { parent: 0 }),
    ]);
    for (const [index, kid] of kept.entries()) {
      if (kid.parent < 0) continue;
      expect(kept[kid.parent]!.depth).toBe(kid.depth - 1);
      expect(kid.parent).toBeLessThan(index);
    }
    expect(names(kept)).toEqual(['Root', 'Column', 'Row', 'Label', 'Footer']);
    expect(kept.map((n) => n.parent)).toEqual([-1, 0, 1, 2, 0]);
  });
});

describe('withoutDevTooling on a tree it recognises nothing in', () => {
  it('drops nothing', () => {
    // The default is that every view shows up. Only a named tool is hidden, so a
    // layout neither platform has shown us comes back whole.
    expect(
      names(
        withoutDevTooling([
          node(0, 'DecorView'),
          node(1, 'SomeHost'),
          node(2, 'SomeContent', 0, { text: 'hello' }),
        ])
      )
    ).toEqual(['DecorView', 'SomeHost', 'SomeContent']);
  });
});

describe('withoutDevTooling and overlays the app puts up itself', () => {
  // The reason the bubble is matched by fragment tag and not by anything it
  // looks like: an app's own floating UI is still the app's UI. A library that
  // lifts a toast or a sheet above the rest shares every visible trait with the
  // bubble — the class names, the full-bleed frame, even the stacking order.
  it('keeps an untagged overlay however it is drawn', () => {
    expect(
      names(
        withoutDevTooling([
          node(0, 'Root', 1),
          node(1, 'ReactViewGroup', 2),
          node(2, 'ReactTextView', 3, { text: 'Hello' }),
          node(2, 'LinearLayout'),
          node(3, 'ComposeView'),
          node(4, 'AndroidComposeView'),
        ])
      )
    ).toEqual([
      'Root',
      'ReactViewGroup',
      'ReactTextView',
      'LinearLayout',
      'ComposeView',
      'AndroidComposeView',
    ]);
  });

  // A fragment the app added is not tooling either — only the tags in the list
  // are, and the list is exact.
  it("keeps a fragment of the app's own", () => {
    expect(
      names(
        withoutDevTooling([
          node(0, 'Root', 1),
          node(1, 'ReactViewGroup', 2),
          node(2, 'ReactTextView', 3, { text: 'Hello' }),
          node(2, 'FrameLayout', 0, { fragment: 'CheckoutSheet' }),
        ])
      )
    ).toEqual(['Root', 'ReactViewGroup', 'ReactTextView', 'FrameLayout']);
  });
});
