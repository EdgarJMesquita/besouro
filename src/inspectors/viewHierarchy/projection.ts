/**
 * The perspective projection behind the exploded 3D stack — the whole 3D engine,
 * as pure arithmetic with no React Native in it.
 *
 * ## Why this exists at all
 *
 * React Native's transform list has no `translateZ`, which looks at first like it
 * rules out real depth. It doesn't. Under a perspective projection at camera
 * distance `P`, a plane sitting at depth `z` projects to a *uniform scale* about
 * the projection centre:
 *
 *     k = P / (P − z)
 *
 * and its centre lands at `(x·k, y·k)`. Both are things RN can express — `scale`
 * and `translateX/Y`. So rather than asking the platform to place a plane in
 * depth, we do the projection here and hand RN the 2D result. The stack converges
 * on a real vanishing point; it is not a shear.
 *
 * ## The derivation
 *
 * Stack axis along z, plane sitting `zBack` behind the front of the stack. Rotate
 * the whole stack by `Ry(yaw)` then `Rx(pitch)` — the same matrices CSS uses, so
 * this stays consistent with what RN does to each sheet's own orientation — and
 * the plane's centre goes to:
 *
 *     x' = −zBack·sin(yaw)
 *     y' =  zBack·cos(yaw)·sin(pitch)
 *     z' = −zBack·cos(yaw)·cos(pitch)
 *
 * then projects through `k = P/(P − z')`. That is [projectPlane], and everything
 * else in the view is drawing.
 *
 * Screen y grows downward, matching CSS, so a negative pitch (looking down onto
 * the stack) yields a negative `translateY` — the far planes ride up the screen.
 *
 * ## Where zoom comes in
 *
 * Everything here works in the scene's own dp — the capture fitted to the stage,
 * before zoom — and `zoom` magnifies the finished projection. It is not a term
 * threaded through the derivation, and that is the point: a zoom is the same
 * picture seen closer, so it has to take the depth with it. Scaling only what
 * lies across the sheets leaves the gaps between them fixed in dp, and the stack
 * concertinas as you pinch — sheets crushed together zoomed in, adrift zoomed out.
 *
 * A magnifier, then, and not a camera walking toward the stack. The dolly is the
 * more literal reading of a zoom and it was considered: hold the lens still and
 * scale the scene into it, and convergence rises as you approach — the near
 * sheets fan apart while the far ones bunch up behind them. Two reasons it is
 * not what happens here. It does not survive the controls: twenty planes at a
 * spread of 60 is 1200dp of stack, which at 4× is 4800dp against a 2200dp lens,
 * and past the lens `P/(P − z)` changes sign and renders the back of the stack
 * inside out. The pivot is a second way in, since its rotated `y` feeds `z` and
 * it scales with zoom too. And convergence is worth holding still on its own
 * account: it is the cue that says *stack*, {@link PERSPECTIVE} is tuned for how
 * it reads, and how far apart the sheets sit already has a control of its own in
 * the spread — a dolly would be a second, indirect one fighting it.
 */

/**
 * Camera distance, in the same dp the translations are in — the lens.
 *
 * This is the convergence knob: close in, the stack converges hard and the back
 * shrinks away; far out, it flattens toward a shear. Fixed rather than
 * adjustable, because neither end is *wrong* and it is a setting with no right
 * answer to hunt for.
 *
 * It was 900, and that was a short lens. It only showed once the stack started
 * opening square on, where convergence is the *only* thing separating the
 * sheets: a 12-deep stack at the default spread put the back sheet at 74% of the
 * front, so the full-bleed run came out as a staircase of corners rather than
 * as one rectangle behind another, and the picture read as slightly turned when
 * it was not turned at all. At 2200 the same stack lands at 88% — depth still
 * legible, and no phantom angle.
 *
 * The cost is real and worth naming: a longer lens foreshortens a rotated sheet
 * less, so turning the stack now reads closer to isometric. That is also nearer
 * to what Xcode's view debugger looks like, so the trade lands on the right side
 * twice.
 */
export const PERSPECTIVE = 2200;

/** Orbit angles in degrees. `yaw` turns the stack, `pitch` tilts it. */
export type Orbit = { yaw: number; pitch: number };

/**
 * The point the stack turns around, in the same space the translations are in.
 *
 * `z` follows the projection's sign: away from the camera is negative, so a
 * plane sitting `zBack` behind the front is at `z: -zBack`.
 */
export type Pivot = { x: number; y: number; z: number };

/**
 * Turning around the middle of the stack — what it did before there was a pivot
 * at all, and what it still does with nothing better to turn around.
 */
export const CENTRE: Pivot = { x: 0, y: 0, z: 0 };

/** Where a plane lands on screen, as the three transforms RN can apply. */
export type ProjectedPlane = {
  translateX: number;
  translateY: number;
  /** The perspective divisor — the piece RN can't express as `translateZ`. */
  scale: number;
};

/**
 * Project the centre of a plane sitting `zBack` behind the front of the stack,
 * with the stack turned around `pivot`.
 *
 * ## What the pivot is for
 *
 * Without one the stack turns around its own middle, which is right until the
 * camera moves. Zoom into a corner and orbit, and the thing you zoomed in on
 * swings away — you were looking at one part of the picture and turning a
 * different one. The fix is not to move the picture afterwards but to turn it
 * around what you are looking at in the first place.
 *
 * ## Why the sheets do not need `transformOrigin`
 *
 * A rigid rotation `R` about a pivot `p` maps `q → p + R(q − p)`. `R` is the
 * same rotation whatever `p` is, so a pivot changes *where each sheet's centre
 * lands* and nothing about how the sheet is turned. Every sheet keeps rotating
 * about its own centre — which is what CSS does by default — and this function
 * absorbs the whole difference.
 *
 * The perspective scale still works out for the same reason it did before: a
 * uniform scale about the projection centre is the same thing as putting the
 * plane's centre at `centre × k` and scaling the sheet by `k` about that centre.
 *
 * At {@link CENTRE} every term below collapses to what it was: `zBack` 0 is the
 * reference plane and comes back untouched at any orbit, so the stack recedes
 * *from* the front sheet rather than around some other origin.
 */
export function projectPlane(
  zBack: number,
  orbit: Orbit,
  pivot: Pivot = CENTRE,
  /**
   * Magnification of the finished picture. `zBack` and `pivot` are in the
   * scene's own dp, so this is the one place zoom enters — see the module note.
   *
   * It moves the translations and deliberately not `scale`: the sheet's own size
   * is drawn at the zoomed fit already, and multiplying here as well would apply
   * the zoom to it twice. Which leaves the perspective divisor untouched by zoom
   * — correct, and not a shortcut. Magnifying the scene means moving the lens
   * back by as much, and `P/(P − z)` with both scaled is the divisor unchanged:
   * the stack converges exactly as hard close up as far out.
   */
  zoom: number = 1
): ProjectedPlane {
  const yaw = toRadians(orbit.yaw);
  const pitch = toRadians(orbit.pitch);

  // The plane's centre, relative to the pivot. Sheets are centred on the stack
  // axis, so its own x and y are zero and only the pivot's offset survives.
  const dx = -pivot.x;
  const dy = -pivot.y;
  const dz = -zBack - pivot.z;

  // Ry(yaw) then Rx(pitch) — the same matrices CSS uses, so this stays
  // consistent with what RN does to each sheet's own orientation.
  const yawed = dx * Math.cos(yaw) + dz * Math.sin(yaw);
  const deep = -dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const tilted = dy * Math.cos(pitch) - deep * Math.sin(pitch);

  // Back into absolute terms: the pivot is the one point rotation leaves alone.
  const x = pivot.x + yawed;
  const y = pivot.y + tilted;
  const z = pivot.z + dy * Math.sin(pitch) + deep * Math.cos(pitch);

  const scale = PERSPECTIVE / (PERSPECTIVE - z);
  return { translateX: x * scale * zoom, translateY: y * scale * zoom, scale };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Zoom and pan that put every drawn sheet on the stage at a given orbit.
 *
 * Turning the stack changes its size *and* where it sits, and neither is
 * predictable from a constant. The sheets fan apart by `spread`, which the user
 * controls and can run from nothing to sixty; the fan grows with how many planes
 * are drawn, which depth controls; each sheet is itself narrower turned and
 * shorter tilted; and the fan is one-sided, so a turned stack is not centred on
 * what it was centred on square on. A fixed pull-back for the turned view is
 * wrong at both ends of all of that, and leaves the stage lopsided besides.
 *
 * Both halves matter and the second is the one that shows: at the preset angle
 * the sheets travel left, so zoom alone frames a stack hugging the left edge with
 * the right half of the stage empty.
 *
 * Only for discrete moves — the view toggle. Re-framing continuously while a
 * finger drags would make the stack breathe under it, which is worse than a stack
 * that runs off the stage and can be pinched back.
 */
export function frameStack(
  zBacks: number[],
  orbit: Orbit,
  /** The sheet's size in the scene's own dp — the fit, before zoom. */
  sheet: { width: number; height: number },
  stage: { width: number; height: number },
  /** The pivot, in the same scene dp as `sheet` and `zBacks`. */
  pivot: Pivot = CENTRE
): { zoom: number; pan: { x: number; y: number } } {
  const still = { zoom: 1, pan: { x: 0, y: 0 } };
  if (!zBacks.length || stage.width <= 0 || stage.height <= 0) return still;

  const box = boundsAt(zBacks, orbit, sheet, pivot);
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  if (width <= 0 || height <= 0) return still;

  // One division per axis, because zoom magnifies the whole scene — depth and
  // all — so the stack's screen extent is simply proportional to it. This was a
  // bisection while the fan between sheets was fixed in dp: the extent was then
  // a max of linear terms minus a min of them, monotonic in zoom but with no
  // closed form worth reading. Zoom taking the depth with it collapsed the
  // search to this.
  //
  // Never past 1 — the toggle frames a stack that has run off the stage, it does
  // not magnify one that fits.
  const zoom = Math.max(
    MIN_FRAME_ZOOM,
    Math.min(1, stage.width / width, stage.height / height)
  );
  const middle = centreOf(box);
  return { zoom, pan: { x: middle.x * zoom, y: middle.y * zoom } };
}

/**
 * The pan that puts a stack's middle on the stage's middle. Pan is applied to
 * the whole scene after projection, so centring is just moving it to the origin.
 */
function centreOf(box: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}): { x: number; y: number } {
  return { x: -(box.minX + box.maxX) / 2, y: -(box.minY + box.maxY) / 2 };
}

/**
 * Floor on the framing. Below this the stack is too small to read anyway, so a
 * stack that will not fit at this zoom is one the camera cannot save — pinch and
 * pan are what is left.
 */
const MIN_FRAME_ZOOM = 0.15;

/** Screen bounds of every drawn sheet, in the scene's dp. */
function boundsAt(
  zBacks: number[],
  orbit: Orbit,
  sheet: { width: number; height: number },
  pivot: Pivot
): { minX: number; maxX: number; minY: number; maxY: number } {
  const yaw = toRadians(orbit.yaw);
  const pitch = toRadians(orbit.pitch);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const zBack of zBacks) {
    const { translateX, translateY, scale } = projectPlane(zBack, orbit, pivot);
    // A rectangle turned about the vertical axis projects `cos(yaw)` as wide,
    // and tilted about the horizontal one, `cos(pitch)` as tall.
    const halfWidth = (sheet.width * scale * Math.abs(Math.cos(yaw))) / 2;
    const halfHeight = (sheet.height * scale * Math.abs(Math.cos(pitch))) / 2;
    minX = Math.min(minX, translateX - halfWidth);
    maxX = Math.max(maxX, translateX + halfWidth);
    minY = Math.min(minY, translateY - halfHeight);
    maxY = Math.max(maxY, translateY + halfHeight);
  }
  return { minX, maxX, minY, maxY };
}
