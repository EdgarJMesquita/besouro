/**
 * The floating panel's frame tracking: what reaches the native surface, and what
 * is rightly dropped before it gets there.
 *
 * The geometry itself is covered next door in `mini-window-geometry.test.ts`;
 * what is tested here is the module's memory of the frame the surface is wearing,
 * which is what decides whether a push is made at all.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const NATIVE_PATH = '../../native/NativeBesouro';

const PANEL = { x: 20, y: 100, width: 200, height: 300 };

/**
 * Load a fresh copy of the module over a fake native surface. Fresh per test
 * because the frame it remembers is module-level — the point of the thing.
 */
function loadMiniWindow(): {
  miniWindow: typeof import('../mini-window');
  setSurfaceFrame: jest.Mock;
} {
  const setSurfaceFrame = jest.fn();
  jest.doMock(NATIVE_PATH, () => ({
    __esModule: true,
    default: { setSurfaceFrame, resetSurfaceFrame: jest.fn() },
  }));
  return {
    miniWindow: require('../mini-window') as typeof import('../mini-window'),
    setSurfaceFrame: setSurfaceFrame as unknown as jest.Mock,
  };
}

describe('drawer/mini-window', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('pushes a frame to the surface, and drops a repeat of the same one', () => {
    const { miniWindow, setSurfaceFrame } = loadMiniWindow();

    miniWindow.setPanelFrame(PANEL);
    expect(setSurfaceFrame).toHaveBeenCalledTimes(1);
    expect(setSurfaceFrame).toHaveBeenCalledWith(
      PANEL.x,
      PANEL.y,
      PANEL.width,
      PANEL.height
    );

    // The dead zone: a drag reports frames far faster than the panel can move,
    // and one that would draw the same pixels is not worth a native call.
    miniWindow.setPanelFrame(PANEL);
    expect(setSurfaceFrame).toHaveBeenCalledTimes(1);
  });

  it('pushes the panel frame again once the surface it described is gone', () => {
    const { miniWindow, setSurfaceFrame } = loadMiniWindow();

    miniWindow.setPanelFrame(PANEL);

    // What the element pick does: native dismisses the drawer and opens a new
    // full-screen surface, and JS is only told after the fact. Without the
    // forget, the push below matches the frame remembered from the surface that
    // no longer exists and is dropped — leaving panel chrome at full-screen size,
    // its header up under the status bar.
    miniWindow.forgetFrame();
    miniWindow.setPanelFrame(PANEL);

    expect(setSurfaceFrame).toHaveBeenCalledTimes(2);
    expect(setSurfaceFrame).toHaveBeenLastCalledWith(
      PANEL.x,
      PANEL.y,
      PANEL.width,
      PANEL.height
    );
  });
});
