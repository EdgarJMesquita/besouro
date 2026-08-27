/**
 * Where the stack is being looked at from.
 *
 * Lifted out of the view that draws it because the controls are not in that view:
 * zoom and reset sit in the same row as Depth and Spread, above the stage, so the
 * tab owns the camera and hands it down. `Exploded` is left with the gesture and
 * the drawing, which is all it should have had.
 */

/** Orbit in degrees, zoom as a multiplier, pan in screen dp. */
export type Camera = {
  yaw: number;
  pitch: number;
  zoom: number;
  pan: { x: number; y: number };
};

/**
 * Opening view: square on, the screen as it actually looks.
 *
 * It used to open turned — 26° of yaw and 16° of tilt — on the reasoning that
 * the separation between sheets is the whole point, so show it immediately. That
 * had it backwards. Arriving at an angle means the first thing you have to do is
 * work out what you are looking at, because nothing on the stage matches the app
 * you just came from. Face-on, the front sheet *is* the screen: you recognise it,
 * then you turn it and watch it come apart. The depth is still there in the
 * perspective — the far sheets are visibly smaller — so nothing is hidden, it is
 * just not the first thing said.
 *
 * Xcode's view debugger opens the same way, and this is the reason.
 *
 * Square on is also the centre of the orbit range rather than a corner of it, so
 * both directions have the same room. At 26° of yaw the stack could turn 49° one
 * way and 101° the other before hitting {@link MAX_ORBIT}.
 */
export const HOME: Camera = {
  yaw: 0,
  pitch: 0,
  zoom: 1,
  pan: { x: 0, y: 0 },
};

/**
 * The turned view the stage toggles to, and the only preset angle in the tab.
 *
 * Positive yaw, so the far sheets travel left and up. That is not arbitrary: the
 * stage's one control sits in the top-right corner, and a stack fanning left is
 * a stack that leaves that corner clear. {@link AngledGlyph} draws the same
 * direction, so the button pictures what pressing it does.
 *
 * Modest on both axes. The angle exists to show *that* the sheets are separate,
 * which the first few degrees already do; past that the sheets foreshorten into
 * slivers and the labels stop being readable. Anything further is a drag away.
 */
export const ANGLED: Camera = {
  yaw: 26,
  pitch: -16,
  zoom: 1,
  pan: { x: 0, y: 0 },
};

/**
 * Orbit limit, both axes.
 *
 * At ±90° the stack is exactly edge-on and every sheet collapses to a line; the
 * approach to it is no better, since a sheet turned that far shows a sliver too
 * narrow to hold a box, let alone a label. There is no information out there, so
 * the camera does not go — an inspector should not have a viewpoint from which it
 * inspects nothing.
 *
 * This costs the ability to orbit behind the stack, which is a real loss in a
 * modelling tool and none at all here: the sheets are flat and unlit, so the far
 * side is the same picture mirrored.
 */
export const MAX_ORBIT = 75;

/** dp of drag per degree of orbit. */
export const ORBIT_SENSITIVITY = 0.35;

/**
 * Zoom range. The floor keeps a deep stack from shrinking out of reach; the
 * ceiling is what makes the view usable at all on a real screen, where the thing
 * you want to look at is a 30dp row somewhere inside a 400dp plane. Enforced on
 * the pinch, which is now the only way to zoom.
 */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 8;

/** Whether the camera has moved off {@link HOME} — gates the reset control. */
export function isMoved(camera: Camera): boolean {
  return (
    camera.yaw !== HOME.yaw ||
    camera.pitch !== HOME.pitch ||
    camera.zoom !== HOME.zoom ||
    camera.pan.x !== 0 ||
    camera.pan.y !== 0
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
