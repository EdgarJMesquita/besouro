/**
 * The pinch's zoom anchoring. The rest of the camera is constants and a
 * comparison; this is the only arithmetic in it, and it is arithmetic whose
 * failure is a picture that slides out from under the fingers — hard to see in a
 * screenshot and obvious in the hand, so it is worth pinning here.
 *
 * The property every case below is really checking: a point on the stage maps to
 * the scene by `(point − pan) / zoom`, so whatever the pinch does, the scene
 * point under the fingers at the start must still be under them at the end.
 */

import { describe, it, expect } from '@jest/globals';
import { clamp, MAX_ZOOM, pinchPan } from '../camera';

/** Where a stage point sits in the scene, given the camera it is drawn under. */
function scenePoint(
  camera: { zoom: number; pan: { x: number; y: number } },
  point: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: (point.x - camera.pan.x) / camera.zoom,
    y: (point.y - camera.pan.y) / camera.zoom,
  };
}

describe('pinchPan', () => {
  const start = { zoom: 1, pan: { x: 0, y: 0 } };

  it('holds the pinched point still while the fingers stay put', () => {
    const fingers = { x: 120, y: -80 };
    const pan = pinchPan(start, fingers, fingers, 2.5);

    expect(scenePoint({ zoom: 2.5, pan }, fingers)).toEqual(
      scenePoint(start, fingers)
    );
  });

  it('leaves the camera alone when nothing about the pinch changed', () => {
    expect(pinchPan(start, { x: 40, y: 40 }, { x: 40, y: 40 }, 1)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('keeps the point under fingers that zoom and travel at once', () => {
    const from = { x: -60, y: 90 };
    const to = { x: 30, y: 45 };
    const pan = pinchPan(start, from, to, 3);

    expect(scenePoint({ zoom: 3, pan }, to)).toEqual(scenePoint(start, from));
  });

  it('anchors off a camera that has already been moved', () => {
    const moved = { zoom: 2, pan: { x: -140, y: 60 } };
    const from = { x: 50, y: 50 };
    const to = { x: 55, y: 20 };
    const pan = pinchPan(moved, from, to, 0.8);

    expect(scenePoint({ zoom: 0.8, pan }, to)).toEqual(scenePoint(moved, from));
  });

  it('is a pure pan once the zoom is clamped', () => {
    // Fingers still spreading against MAX_ZOOM: the ratio is frozen, so the only
    // thing left for the pan to follow is how far they have travelled. Anything
    // else here is the picture creeping under a gesture that has stopped zooming.
    const held = { zoom: MAX_ZOOM, pan: { x: 12, y: -34 } };
    const from = { x: 10, y: 10 };
    const to = { x: 25, y: -5 };
    const zoom = clamp(MAX_ZOOM * 1.4, 0.4, MAX_ZOOM);

    expect(pinchPan(held, from, to, zoom)).toEqual({
      x: held.pan.x + (to.x - from.x),
      y: held.pan.y + (to.y - from.y),
    });
  });

  it('zooms about the middle of the stage when that is where the fingers are', () => {
    // The old behaviour, which was the only behaviour: with the midpoint on the
    // stage's centre there is nothing to correct for, and the pan stays where it
    // was. Every other case above is what that missed.
    const middle = { x: 0, y: 0 };
    expect(pinchPan(start, middle, middle, 4)).toEqual({ x: 0, y: 0 });
  });
});
