/**
 * The floating panel's geometry, as arithmetic: what a frame is allowed to be,
 * and how one is stored so it survives a relaunch onto a different screen.
 *
 * Pure on purpose — every function takes the screen it is reasoning about rather
 * than reading it. That keeps the rules testable without a device, and leaves
 * `./mini-window` as the only place that touches `Dimensions`, the insets and the
 * native surface.
 */

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The screen the panel lives on, and the bars it must stay clear of. */
export interface ScreenBounds {
  width: number;
  height: number;
  top: number;
  bottom: number;
}

/**
 * A frame as persisted between launches.
 *
 * The position is a **ratio of the range the panel can travel**, not a
 * coordinate: the phone it is read back on may be a different size or a
 * different way up than the one it was written on, and a stored `x: 300` is
 * off-screen on a narrower device. A ratio means "three quarters of the way
 * across", which is true anywhere. Size stays in dp — a panel sized to fit some
 * content should keep that size, not grow with the screen — and is re-clamped on
 * read.
 */
export interface StoredFrame {
  xRatio: number;
  yRatio: number;
  width: number;
  height: number;
}

/**
 * The size band. The minimum is the point below which the panel can no longer
 * hold its own header — title, restore, close — so the way out is always on
 * screen; the maximum is the screen itself. The shape in between is the user's
 * call: a tall column down one side, a wide strip across the top, or the lot.
 */
export const MIN_WIDTH = 160;
export const MIN_HEIGHT = 140;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** How far the panel can travel, given its size. Zero when it fills that axis. */
function travelRange(
  frame: Frame,
  bounds: ScreenBounds
): {
  x: number;
  y: number;
} {
  return {
    x: Math.max(0, bounds.width - frame.width),
    y: Math.max(0, bounds.height - bounds.top - bounds.bottom - frame.height),
  };
}

/**
 * Pull a frame inside the screen and out from under the system bars.
 *
 * The top inset is the one that matters: the surface is attached behind the
 * status bar, which takes the touches in that strip, so a panel released up there
 * keeps its header but loses the ability to be grabbed by it — no drag, no
 * restore, no close. Clamping the top edge below the inset is what keeps the
 * panel recoverable. The bottom inset earns its clamp the same way, against the
 * home indicator and the gesture strip, which would swallow the resize grip.
 */
export function clampFrame(frame: Frame, bounds: ScreenBounds): Frame {
  const width = clamp(frame.width, MIN_WIDTH, bounds.width);
  const height = clamp(
    frame.height,
    MIN_HEIGHT,
    bounds.height - bounds.top - bounds.bottom
  );
  const sized = { ...frame, width, height };
  const range = travelRange(sized, bounds);
  return {
    width,
    height,
    x: clamp(frame.x, 0, range.x),
    y: clamp(frame.y, bounds.top, bounds.top + range.y),
  };
}

/** Where the panel first appears: upper-right, clear of the status bar. */
export function defaultFrame(bounds: ScreenBounds): Frame {
  const width = Math.min(240, bounds.width - 24);
  return clampFrame(
    {
      width,
      height: 320,
      x: bounds.width - width - 12,
      y: bounds.top + 48,
    },
    bounds
  );
}

/** Turn a live frame into something worth writing to disk. */
export function normalizeFrame(
  frame: Frame,
  bounds: ScreenBounds
): StoredFrame {
  const range = travelRange(frame, bounds);
  return {
    // A panel that fills an axis has nowhere to travel on it; pinning the ratio
    // at 0 keeps it against the origin rather than dividing by zero.
    xRatio: range.x > 0 ? clamp(frame.x / range.x, 0, 1) : 0,
    yRatio: range.y > 0 ? clamp((frame.y - bounds.top) / range.y, 0, 1) : 0,
    width: frame.width,
    height: frame.height,
  };
}

/**
 * Rebuild a frame from what was stored, against the screen it is being restored
 * onto. Clamped on the way out, so a value written on a larger screen — or
 * before a rotation — lands somewhere reachable rather than off the edge.
 */
export function denormalizeFrame(
  stored: StoredFrame,
  bounds: ScreenBounds
): Frame {
  const sized = clampFrame(
    { x: 0, y: bounds.top, width: stored.width, height: stored.height },
    bounds
  );
  const range = travelRange(sized, bounds);
  return clampFrame(
    {
      ...sized,
      x: stored.xRatio * range.x,
      y: bounds.top + stored.yRatio * range.y,
    },
    bounds
  );
}

/**
 * Whether a value read back off disk is a frame at all. Settings are a JSON file
 * a user can edit and an older build can have written, so this is the boundary
 * where anything else becomes "no stored frame".
 */
export function isStoredFrame(value: unknown): value is StoredFrame {
  if (typeof value !== 'object' || value === null) return false;
  const frame = value as Partial<StoredFrame>;
  return (
    typeof frame.xRatio === 'number' &&
    typeof frame.yRatio === 'number' &&
    typeof frame.width === 'number' &&
    typeof frame.height === 'number' &&
    Number.isFinite(frame.xRatio) &&
    Number.isFinite(frame.yRatio) &&
    Number.isFinite(frame.width) &&
    Number.isFinite(frame.height)
  );
}
