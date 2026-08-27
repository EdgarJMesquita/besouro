/**
 * The perspective projection behind the exploded stack.
 *
 * RN has no `translateZ`, so {@link projectPlane} does the projection itself and
 * hands RN a `translateX/translateY/scale` triple. That makes the depth real
 * rather than sheared — and makes it arithmetic, which is worth pinning down: a
 * sign error here doesn't crash, it just draws a stack that leans the wrong way,
 * which is the kind of bug you stare past.
 */

import { describe, it, expect } from '@jest/globals';
import { CENTRE, frameStack, PERSPECTIVE, projectPlane } from '../projection';

const FLAT = { yaw: 0, pitch: 0 };

describe('projectPlane', () => {
  it('leaves the frontmost plane exactly where it is', () => {
    // zBack 0 is the reference plane the rest of the stack recedes from, at any
    // orbit — if this drifts, the whole stack slides as you turn it.
    for (const orbit of [
      FLAT,
      { yaw: 26, pitch: -16 },
      { yaw: -75, pitch: 40 },
    ]) {
      const projected = projectPlane(0, orbit);
      // Per-field rather than `toEqual`: negating zero yields `-0`, which is the
      // same placement but not the same value.
      expect(projected.translateX).toBeCloseTo(0);
      expect(projected.translateY).toBeCloseTo(0);
      expect(projected.scale).toBe(1);
    }
  });

  it('recedes without sliding when the stack faces the camera', () => {
    const { translateX, translateY, scale } = projectPlane(100, FLAT);
    expect(translateX).toBeCloseTo(0);
    expect(translateY).toBeCloseTo(0);
    // Head-on, the projection is the plain perspective divisor: P / (P + zBack).
    expect(scale).toBeCloseTo(PERSPECTIVE / (PERSPECTIVE + 100));
  });

  it('shrinks monotonically with depth', () => {
    const orbit = { yaw: 26, pitch: -16 };
    // Equal steps, so the gaps between them are directly comparable.
    const scales = [0, 50, 100, 150, 200].map(
      (z) => projectPlane(z, orbit).scale
    );
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]!).toBeLessThan(scales[i - 1]!);
    }
    // A vanishing point, not a linear ramp: the stack must converge, so equal
    // depth steps have to shrink by less and less.
    expect(scales[0]! - scales[1]!).toBeGreaterThan(scales[3]! - scales[4]!);
  });

  it('sends the stack away from the yaw direction', () => {
    // Turning right (positive yaw) swings the far end of the stack left, which is
    // what makes the sheets fan out instead of hiding behind each other.
    expect(projectPlane(100, { yaw: 30, pitch: 0 }).translateX).toBeLessThan(0);
    expect(
      projectPlane(100, { yaw: -30, pitch: 0 }).translateX
    ).toBeGreaterThan(0);
  });

  it('lifts the far end when the camera tilts down', () => {
    // Screen y grows downward, so a negative pitch — looking down onto the stack —
    // has to push the far planes *up* the screen.
    expect(projectPlane(100, { yaw: 0, pitch: -20 }).translateY).toBeLessThan(
      0
    );
    expect(projectPlane(100, { yaw: 0, pitch: 20 }).translateY).toBeGreaterThan(
      0
    );
  });

  it('separates the planes at every orbit that is not edge-on', () => {
    // The one thing the view exists to do. At 90° yaw the stack is edge-on and
    // collapsing is correct, which is why the pitch is clamped short of it.
    for (const yaw of [10, 26, 45, 80]) {
      const { translateX } = projectPlane(100, { yaw, pitch: -16 });
      expect(Math.abs(translateX)).toBeGreaterThan(1);
    }
  });
});

describe('projectPlane with a pivot', () => {
  const ORBIT = { yaw: 30, pitch: -20 };
  const PIVOT = { x: 40, y: -25, z: -60 };

  // The whole promise of a pivot: it is the one point rotation leaves alone.
  // Pinned on a plane's own centre, so that plane is exactly the pivot and has
  // to come back untouched however far the stack is turned.
  it('leaves a plane pinned at the pivot where it is, at any orbit', () => {
    const onAxis = { x: 0, y: 0, z: -60 };
    const still = projectPlane(60, { yaw: 0, pitch: 0 }, onAxis);
    for (const orbit of [
      ORBIT,
      { yaw: -70, pitch: 55 },
      { yaw: 15, pitch: 0 },
    ]) {
      expect(projectPlane(60, orbit, onAxis)).toEqual(still);
    }
  });

  // The old signature has to keep meaning what it meant, since every existing
  // reading of the stack was derived against it.
  it('is unchanged from the pivotless projection at the centre', () => {
    for (const z of [0, 50, 120]) {
      const withPivot = projectPlane(z, ORBIT, CENTRE);
      const without = projectPlane(z, ORBIT);
      expect(withPivot).toEqual(without);
    }
  });

  it('still recedes: a further plane projects smaller', () => {
    const near = projectPlane(0, ORBIT, PIVOT).scale;
    const far = projectPlane(200, ORBIT, PIVOT).scale;
    expect(far).toBeLessThan(near);
  });

  it('lands a plane somewhere else once the pivot moves off the axis', () => {
    const centred = projectPlane(100, ORBIT);
    const pivoted = projectPlane(100, ORBIT, PIVOT);
    expect(pivoted.translateX).not.toBeCloseTo(centred.translateX);
  });
});

describe('frameStack', () => {
  const SHEET = { width: 300, height: 640 };
  const STAGE = { width: 340, height: 380 };
  const SQUARE_ON = { yaw: 0, pitch: 0 };
  // The preset angle: sheets fan left and up.
  const ANGLED = { yaw: 26, pitch: -16 };
  const stack = [0, 30, 60, 90, 120, 150];

  it('pulls back until the whole stack is on the stage', () => {
    const { zoom, pan } = frameStack(stack, ANGLED, SHEET, STAGE);
    const bounds = extentOf(stack, ANGLED, SHEET, zoom, pan);
    expect(bounds.width).toBeLessThanOrEqual(STAGE.width + 0.5);
    expect(bounds.height).toBeLessThanOrEqual(STAGE.height + 0.5);
  });

  // The half that shows. A one-sided fan means zoom alone leaves the stack
  // against one edge with the opposite half of the stage empty.
  it('centres the stack, not the sheet it fans from', () => {
    const { zoom, pan } = frameStack(stack, ANGLED, SHEET, STAGE);
    const bounds = extentOf(stack, ANGLED, SHEET, zoom, pan);
    expect(bounds.centreX).toBeCloseTo(0);
    expect(bounds.centreY).toBeCloseTo(0);
  });

  it('does not zoom past 1 when there is room to spare', () => {
    const roomy = { width: 4000, height: 4000 };
    expect(frameStack(stack, ANGLED, SHEET, roomy).zoom).toBe(1);
  });

  // Square on there is no fan, so a single sheet is all there is to fit.
  it('leaves a flat stack centred', () => {
    const { pan } = frameStack(stack, SQUARE_ON, SHEET, STAGE);
    expect(pan.x).toBeCloseTo(0);
    expect(pan.y).toBeCloseTo(0);
  });

  it('has nothing to do with no sheets', () => {
    expect(frameStack([], ANGLED, SHEET, STAGE)).toEqual({
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
  });
});

/** Screen extent of the framed stack — the thing `frameStack` is solving for. */
function extentOf(
  zBacks: number[],
  orbit: { yaw: number; pitch: number },
  sheet: { width: number; height: number },
  zoom: number,
  pan: { x: number; y: number }
) {
  const yaw = (orbit.yaw * Math.PI) / 180;
  const pitch = (orbit.pitch * Math.PI) / 180;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const zBack of zBacks) {
    const { translateX, translateY, scale } = projectPlane(zBack, orbit);
    const halfWidth =
      (sheet.width * zoom * scale * Math.abs(Math.cos(yaw))) / 2;
    const halfHeight =
      (sheet.height * zoom * scale * Math.abs(Math.cos(pitch))) / 2;
    minX = Math.min(minX, translateX + pan.x - halfWidth);
    maxX = Math.max(maxX, translateX + pan.x + halfWidth);
    minY = Math.min(minY, translateY + pan.y - halfHeight);
    maxY = Math.max(maxY, translateY + pan.y + halfHeight);
  }
  return {
    width: maxX - minX,
    height: maxY - minY,
    centreX: (minX + maxX) / 2,
    centreY: (minY + maxY) / 2,
  };
}
