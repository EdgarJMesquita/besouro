/**
 * The JS half of the capture — everything that isn't a UIKit/Android call.
 *
 * Which is exactly the point of testing it: the payload crosses a version
 * boundary (a JS bundle can meet an older native build with no `snapshotViewTree`
 * at all), so the parse has to be guarded rather than trusted, and a devtool that
 * throws while inspecting is worse than one that shows nothing.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// The module reads the spec's default export, so each test resets the registry
// and re-mocks before importing. `__esModule: true` so esModuleInterop unwraps
// `default` instead of re-wrapping it.
const SPEC_PATH = '../../../native/NativeBesouro';

function loadSnapshot() {
  return require('../snapshot') as typeof import('../snapshot');
}

function mockNative(snapshotViewTree: unknown): void {
  jest.doMock(SPEC_PATH, () => ({
    __esModule: true,
    default: { snapshotViewTree },
  }));
}

describe('captureViewTree', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('reports unavailable when the native module is not linked', async () => {
    // `TurboModuleRegistry.get` resolves to null for an unregistered module
    // (Expo Go / web / tests), so "not linked" is a null default export.
    jest.doMock(SPEC_PATH, () => ({ __esModule: true, default: null }));
    const { captureViewTree, isHierarchyAvailable } = loadSnapshot();
    expect(isHierarchyAvailable()).toBe(false);
    await expect(captureViewTree()).resolves.toBeNull();
  });

  it('parses a snapshot', async () => {
    const json = JSON.stringify({
      width: 390,
      height: 844,
      truncated: false,
      nodes: [
        {
          tag: 11,
          className: 'ReactViewGroup',
          testID: '',
          text: '',
          textSize: 0,
          textAlign: '',
          radius: 0,
          depth: 0,
          parent: -1,
          left: 0,
          top: 0,
          width: 390,
          height: 844,
        },
        {
          tag: 13,
          className: 'ReactTextView',
          testID: 'title',
          text: 'Hello',
          textSize: 0,
          textAlign: '',
          radius: 0,
          depth: 1,
          parent: 0,
          left: 16,
          top: 64,
          width: 200,
          height: 24,
        },
      ],
    });
    mockNative(jest.fn<() => Promise<string>>().mockResolvedValue(json));

    const { captureViewTree } = loadSnapshot();
    const result = await captureViewTree();

    expect(result).not.toBeNull();
    expect(result?.nodes).toHaveLength(2);
    expect(result?.nodes[1]?.testID).toBe('title');
    // Text rides along on the node so the 3D view can print it inside the box —
    // the difference between a labelled rectangle and an anonymous one.
    expect(result?.nodes[1]?.text).toBe('Hello');
    expect(result?.nodes[1]?.depth).toBe(1);
  });

  it('keeps the truncated flag, so a partial tree is not shown as whole', async () => {
    mockNative(
      jest.fn<() => Promise<string>>().mockResolvedValue(
        // `rootTag` is a field the payload no longer carries. It stays in
        // this fixture on purpose: a JS bundle meets whatever native build is
        // installed, so the parse has to ignore what it does not know rather
        // than choke on it.
        '{"rootTag":0,"width":0,"height":0,"truncated":true,"nodes":[]}'
      )
    );
    const { captureViewTree } = loadSnapshot();
    expect((await captureViewTree())?.truncated).toBe(true);
  });

  it('defaults missing scalars rather than propagating undefined', async () => {
    // An older native build could answer with fewer fields. `nodes` is the one
    // field with no sensible default — without it there is no snapshot.
    mockNative(
      jest.fn<() => Promise<string>>().mockResolvedValue('{"nodes":[]}')
    );
    const { captureViewTree } = loadSnapshot();
    const result = await captureViewTree();
    expect(result).toEqual({
      width: 0,
      height: 0,
      truncated: false,
      nodes: [],
    });
  });

  it('fills in everything a sparse node leaves out', async () => {
    // The capture omits text, testID, text style and radius on views that have
    // none — which is most of them — so a node arrives carrying only what it
    // actually has. `HierarchyNode` stays a complete record regardless.
    mockNative(
      jest.fn<() => Promise<string>>().mockResolvedValue(
        JSON.stringify({
          width: 402,
          height: 874,
          nodes: [
            {
              tag: 1,
              className: 'V',
              depth: 0,
              parent: -1,
              left: 0,
              top: 0,
              width: 402,
              height: 874,
            },
          ],
        })
      )
    );
    const { captureViewTree } = loadSnapshot();
    expect((await captureViewTree())?.nodes[0]).toEqual({
      tag: 1,
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
      width: 402,
      height: 874,
    });
  });

  it('reconstructs `parent` when the native build predates it', async () => {
    // Nearest preceding node one level shallower — the assumption every consumer
    // made before the field existed, now made explicit.
    // Tagged, or `withoutDevTooling` would take the whole branch as tooling.
    const node = (depth: number) => ({
      tag: 1,
      className: 'V',
      depth,
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    });
    mockNative(
      jest
        .fn<() => Promise<string>>()
        .mockResolvedValue(
          JSON.stringify({ nodes: [node(0), node(1), node(2), node(1)] })
        )
    );
    const { captureViewTree } = loadSnapshot();
    const parents = (await captureViewTree())?.nodes.map((n) => n.parent);
    expect(parents).toEqual([-1, 0, 1, 0]);
  });

  it('returns null for a payload that is not a snapshot', async () => {
    for (const payload of ['not json', 'null', '[]', '{"nodes":"lots"}']) {
      jest.resetModules();
      mockNative(jest.fn<() => Promise<string>>().mockResolvedValue(payload));
      const { captureViewTree } = loadSnapshot();
      await expect(captureViewTree()).resolves.toBeNull();
    }
  });

  it('swallows a rejecting native call', async () => {
    // An old native build has no `snapshotViewTree`; the TurboModule invoke
    // rejects rather than resolving, and the tab must survive it.
    mockNative(
      jest
        .fn<() => Promise<string>>()
        .mockRejectedValue(new Error('no such method'))
    );
    const { captureViewTree } = loadSnapshot();
    await expect(captureViewTree()).resolves.toBeNull();
  });
});
