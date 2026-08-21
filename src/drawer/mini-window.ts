/**
 * The floating panel's live geometry: the frame the native surface is wearing,
 * the frame the panel remembers, and the animation between them.
 *
 * The frame lives here rather than in the shell because two places need it and
 * neither owns it: the panel's own drag and resize write to it, and the shell
 * animates the drawer *into* it when minimizing and back out when restoring. It
 * is module-level for the same reason the active inspector is — closing the
 * drawer tears the whole surface down, and a panel that forgot where it was
 * every time would be worse than one that never moved. Across launches it is
 * remembered in settings, the same way the native bubble remembers its corner.
 *
 * The rules themselves — bounds, clamping, how a frame is stored — are pure and
 * live in `./mini-window-geometry`. This file is the part that reads the screen
 * and talks to native.
 */

import { Animated, Dimensions, Easing, PixelRatio } from 'react-native';
import NativeBesouro from '../native/NativeBesouro';
import {
  getSafeAreaInsetsSnapshot,
  getTopInsetSnapshot,
} from '../shared/hooks/safe-area';
import { readJsonFile, writeJsonFile } from '../core/json-file';
import {
  clampFrame as clampFrameIn,
  defaultFrame,
  denormalizeFrame,
  isStoredFrame,
  normalizeFrame,
  type Frame,
  type ScreenBounds,
  type StoredFrame,
} from './mini-window-geometry';

/**
 * The panel's remembered shape gets its own file, beside the bubble's
 * `bubble-position.json`: one floating thing's geometry per file.
 *
 * Kept out of `persisted-state.ts` because this is the noisiest writer we have —
 * a write on every drag and every resize that ends — and that store rewrites its
 * whole document each time, which would drag every unrelated view-mode preference
 * through a gesture that has nothing to do with them.
 */
const FRAME_FILE = 'besouro_mini_window.json';

/**
 * The frame restored from disk: `null` until {@link hydrateMiniWindow} lands, and
 * after it when nothing was stored. Held here rather than re-read per call so
 * {@link getPanelFrame} can stay synchronous — it runs while the panel is
 * mounting, with no frame to wait on.
 */
let storedFrame: StoredFrame | null = null;

/**
 * Read the remembered frame off disk. Called once at install; a panel that opens
 * before this lands simply starts in its default corner.
 */
export async function hydrateMiniWindow(): Promise<void> {
  const raw = await readJsonFile<StoredFrame>(FRAME_FILE);
  // Validated here rather than at the call site: this is the only code that
  // knows the shape, and a hand-edited or half-written file is just "no frame".
  storedFrame = isStoredFrame(raw) ? raw : null;
}

export type { Frame } from './mini-window-geometry';

/** How long the drawer takes to fold into the panel, matching the drawer slide. */
const COLLAPSE_DURATION = 220;

/**
 * The screen as it is right now. Read per call rather than cached, so a rotation
 * between two gestures re-clamps instead of leaving the panel off-screen.
 */
function currentBounds(): ScreenBounds {
  const screen = Dimensions.get('screen');
  return {
    width: screen.width,
    height: screen.height,
    top: getTopInsetSnapshot(),
    bottom: getSafeAreaInsetsSnapshot().bottom,
  };
}

/** Pull a frame inside the screen and clear of the system bars. */
export function clampFrame(frame: Frame): Frame {
  return clampFrameIn(frame, currentBounds());
}

/** The whole screen — what the surface is sized to whenever the drawer is open. */
export function fullScreenFrame(): Frame {
  const screen = Dimensions.get('screen');
  return { x: 0, y: 0, width: screen.width, height: screen.height };
}

let panelFrame: Frame | null = null;

/** What the surface is actually sized to right now. */
let current: Frame = fullScreenFrame();

/**
 * Where the panel is, or would be: the frame from this session, else the one
 * remembered from the last, else the default corner. Clamped on every read, so
 * whatever it came from lands on this screen.
 */
export function getPanelFrame(): Frame {
  const bounds = currentBounds();
  if (!panelFrame) {
    panelFrame = storedFrame
      ? denormalizeFrame(storedFrame, bounds)
      : defaultFrame(bounds);
  }
  panelFrame = clampFrameIn(panelFrame, bounds);
  return panelFrame;
}

/**
 * Remember the panel's shape for the next launch.
 *
 * Called when a gesture *ends*, not while it runs: this is persisted to a file on
 * every change, and a drag would otherwise write it twenty times a second to
 * record positions the finger is still passing through.
 */
export function savePanelFrame(): void {
  if (!panelFrame) return;
  const next = normalizeFrame(panelFrame, currentBounds());
  // Kept in step so a later read in this session sees what was written, without
  // waiting on the file.
  storedFrame = next;
  void writeJsonFile(FRAME_FILE, next);
}

/** Push a frame to the native surface, clamped. Also remembers it as the panel's. */
export function setPanelFrame(frame: Frame): Frame {
  const next = clampFrame(frame);
  panelFrame = next;
  applyFrame(next);
  return next;
}

/**
 * Round a frame to whole device pixels — the granularity the screen can actually
 * show, and the one both native sides round to anyway.
 */
function snapToPixels(frame: Frame): Frame {
  return {
    x: PixelRatio.roundToNearestPixel(frame.x),
    y: PixelRatio.roundToNearestPixel(frame.y),
    width: PixelRatio.roundToNearestPixel(frame.width),
    height: PixelRatio.roundToNearestPixel(frame.height),
  };
}

function sameFrame(a: Frame, b: Frame): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/**
 * Push a frame to the native surface — unless it would draw the same pixels.
 *
 * A pan fires far faster than the panel can visibly move, and an animation tick
 * lands wherever the easing curve puts it, so a good share of the frames these
 * produce differ by a fraction of a pixel. Rounding first and comparing skips
 * those outright: no module call, no UI-thread runnable, nothing on either side.
 *
 * Note this is a dead zone, not a debounce. A drag must never lag the finger, so
 * the filter is on *change* rather than on time: every touch move that moves
 * something is applied immediately, and only the ones that would move nothing are
 * dropped.
 */
function applyFrame(frame: Frame): void {
  const next = snapToPixels(frame);
  if (sameFrame(next, current)) {
    return;
  }
  current = next;
  NativeBesouro?.setSurfaceFrame(next.x, next.y, next.width, next.height);
}

let running: Animated.CompositeAnimation | null = null;

/**
 * Animate the surface from its current frame to `target`, then run `onDone`.
 *
 * Driven from JS, because a surface frame is not an animatable prop — each tick
 * is a `setSurfaceFrame` call, the same thing a drag does per touch move, at a
 * rate we measured a gesture already sustaining comfortably. A second call
 * interrupts the first from wherever it got to, so minimize-then-restore mid-flight
 * does not fight itself.
 */
export function animateFrameTo(target: Frame, onDone?: () => void): void {
  running?.stop();

  const from = current;
  const to = clampFrame(target);
  const progress = new Animated.Value(0);
  const listener = progress.addListener(({ value }) => {
    applyFrame({
      x: from.x + (to.x - from.x) * value,
      y: from.y + (to.y - from.y) * value,
      width: from.width + (to.width - from.width) * value,
      height: from.height + (to.height - from.height) * value,
    });
  });

  running = Animated.timing(progress, {
    toValue: 1,
    duration: COLLAPSE_DURATION,
    easing: Easing.out(Easing.cubic),
    // The value drives a native module call through the listener above, which the
    // native driver would starve — it keeps the animation off the JS thread
    // entirely and never calls back per frame.
    useNativeDriver: false,
  });
  running.start(({ finished }) => {
    progress.removeListener(listener);
    running = null;
    // Land exactly on the target: an interrupted run stops wherever it was, and
    // the last tick of a finished one can fall a fraction short.
    if (finished) {
      applyFrame(to);
      onDone?.();
    }
  });
}

/**
 * Forget what the surface is wearing, without telling native anything.
 *
 * `current` is only allowed to drop a push because it is true, and it outlives
 * the surface it describes: this module is state in the app's JS context, while
 * the surface is created and torn down under it. A drawer dismissed natively —
 * which is how the element pick clears the way for the app to take the tap —
 * leaves the panel's frame remembered here and comes back as a fresh full-screen
 * surface, with nothing in JS having heard about either. The next push would then
 * match that remembered frame exactly and be dropped as a no-op, leaving panel
 * chrome stretched over the whole screen: the header, and the close button with
 * it, up under the status bar where the system takes the touches and the drawer
 * can no longer be closed.
 *
 * So whoever knows the surface is new says so here, and the next push lands.
 */
export function forgetFrame(): void {
  running?.stop();
  running = null;
  current = fullScreenFrame();
}

/**
 * Hand the surface back to the full screen. The native side goes back to filling
 * its host rather than holding a frame, so rotation and window changes are its
 * problem again and not ours.
 */
export function releaseFrame(): void {
  forgetFrame();
  NativeBesouro?.resetSurfaceFrame();
}
