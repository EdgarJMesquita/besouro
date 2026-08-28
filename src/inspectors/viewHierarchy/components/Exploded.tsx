/**
 * The exploded 3D view: one translucent plane per depth level, stacked
 * back-to-front, orbitable. Safari's Layers panel.
 *
 * This is what makes the capture legible. Flattened onto one plane, a native RN
 * tree is concentric rectangles — every view is nested inside another, so nothing
 * separates. Pulling each depth level onto its own sheet is the whole readability
 * mechanism, not a flourish on top of one.
 *
 * The depth itself is real, not a shear: RN has no `translateZ`, so the
 * projection is computed in `../projection` and handed to RN as the
 * `translateX/translateY/scale` triple it *can* apply. See that module for the
 * derivation.
 *
 * What is left here is the stage, the camera and the grouping: which views land
 * on which sheet, where the stack is being looked at from, and the gestures that
 * move that. The sheets themselves are `Plane`, and what is drawn on them is
 * `Box`.
 *
 * One finger orbits, two fingers move the camera — spread to zoom about the
 * point between them, slide to pan — and a tap still falls through to select a
 * view. The camera moves; the stack never does.
 *
 * `PanResponder` rather than a gesture library: this is a devtool that will not
 * add a peer dependency to a host app for three gestures.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeTouchEvent,
  type PanResponderGestureState,
} from 'react-native';
import { useBesouroUI } from '../../../shared/context';
import { radius, space } from '../../../theme/tokens';
import { Icon } from '../../../shared/components/Icon';
import { useDoubleTap } from '../../../shared/hooks/double-tap';
import {
  CENTRE,
  frameStack,
  projectPlane,
  type Orbit,
  type Pivot,
} from '../projection';
import {
  ANGLED,
  clamp,
  HOME,
  isMoved,
  MAX_ORBIT,
  MAX_ZOOM,
  MIN_ZOOM,
  ORBIT_SENSITIVITY,
  pinchPan,
  type Camera,
} from '../utils/camera';
import { coversFrame, frameOf, subtreeRange } from '../utils/focus';
import { isOnScreen } from '../utils/visibility';
import type { PlacedNode, ViewTreeSnapshot } from '../types';
import { Plane } from './Plane';

/**
 * How much of the stage the frame is fitted into, before zoom.
 *
 * Was 0.6, held back that far because the stack is wider than one sheet once it
 * is turned and a tilted sheet is taller than its own height — the margin was
 * paying for an orbit the view opened at.
 *
 * It does not open turned any more (see `HOME`), so the opening view is a screen
 * drawn at 60% of a stage it could nearly fill, with dead margin on every side —
 * and the opening view is what most people spend most of their time in. The
 * margin now covers the modest turn, and a hard orbit runs off the stage, which
 * is what pan and zoom are for and what the stage clips for.
 */
const STAGE_MARGIN = 0.86;

export function Exploded({
  snapshot,
  planes,
  depth,
  maxDepth,
  spread,
  selected,
  onSelect,
  onClear,
  focus,
  onFocus,
}: {
  snapshot: ViewTreeSnapshot;
  /** Plane index per node, parallel to `snapshot.nodes` — see `./planes`. */
  planes: number[];
  /**
   * Planes to draw, inclusive — a window into the stack, closed from either end.
   * Clamped here rather than at the control, so a value left over from before a
   * focus change cannot ask for sheets that no longer exist.
   */
  depth: { from: number; to: number };
  /**
   * Deepest plane the focus can draw, counted from its own root — the ceiling
   * the tab's depth control runs to. Passed in rather than derived here so the
   * control and the drawing cannot disagree about how tall the stack is.
   */
  maxDepth: number;
  /** dp between adjacent planes, before projection. */
  spread: number;
  /** Index into `snapshot.nodes`, or null. */
  selected: number | null;
  onSelect: (index: number) => void;
  /** A tap that hit no box — see the backdrop below. */
  onClear: () => void;
  /** Index of the focused root, or null for the whole capture. See `./focus`. */
  focus: number | null;
  onFocus: (index: number) => void;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<Camera>(HOME);
  const orbit: Orbit = view;

  const stage = useRef<React.ComponentRef<typeof View>>(null);
  /**
   * The middle of the stage, in the frame touches arrive in.
   *
   * Needed because a pinch has to know where on the stage the fingers are, and a
   * touch only says where it is on the root view. `onLayout` gives the stage's
   * size but its position relative to a parent, which is not that frame, so this
   * is measured rather than derived.
   *
   * `measure` and deliberately not `measureInWindow`, which is the same numbers
   * plus the viewport offset — the root view's own position in the window. On
   * iOS that offset is zero and the two are interchangeable; on Android the root
   * sits below the status bar, so `measureInWindow` reads a stage some 24 to 48dp
   * lower than the one the touches are describing, and the zoom anchors that far
   * above the fingers. A bug that cannot reproduce on the platform it is most
   * likely to be tested on, which is reason enough to name it here.
   *
   * Re-measured on every layout, which is every time the drawer opens or is
   * resized — the moves that can put the stage somewhere else.
   */
  const centre = useRef({ x: 0, y: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout;
    setBox({ width, height });
    stage.current?.measure((_x, _y, measured, high, pageX, pageY) => {
      centre.current = { x: pageX + measured / 2, y: pageY + high / 2 };
    });
  }, []);

  // Refs rather than reading state in the handlers: the PanResponder is built
  // once, so its closures would otherwise see the view as it was on first render
  // and every gesture would restart from the opening angle.
  const viewRef = useRef(view);
  viewRef.current = view;
  /**
   * Where the current gesture phase started — the view at that moment, the
   * accumulated pan offset then, and where the fingers were. All of it matters:
   * `gesture.dx` keeps counting across a finger going down or up, so re-anchoring
   * on every change of finger count is what stops the stack lurching when a pinch
   * becomes a drag, and the pinch holds its own starting midpoint still rather
   * than the middle of the stage.
   */
  const anchor = useRef({ ...HOME, dx: 0, dy: 0, pinch: 0, focal: ORIGIN });
  const fingers = useRef(0);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Let a tap through to the boxes underneath: only claim the gesture once
        // the finger has actually moved. This is what lets one surface both
        // orbit and select without a mode switch.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (event, gesture) =>
          // A second finger is always ours. `gesture.dx/dy` track the *centroid*,
          // which a symmetric pinch barely moves — gating on movement alone would
          // leave zoom unreachable.
          event.nativeEvent.touches.length >= 2 ||
          Math.abs(gesture.dx) > 3 ||
          Math.abs(gesture.dy) > 3,
        onPanResponderGrant: (event, gesture) => {
          fingers.current = 0;
          reanchor(event, gesture);
        },
        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;
          // A finger landing or lifting changes what the numbers mean, so start a
          // fresh phase from wherever the view is now.
          if (touches.length !== fingers.current) {
            reanchor(event, gesture);
            return;
          }
          if (touches.length >= 2) {
            const separation = touchDistance(touches[0]!, touches[1]!);
            if (anchor.current.pinch > 0) {
              // Two fingers move the camera and nothing else: spread to zoom,
              // slide to pan. Orbit stays on one finger deliberately — the
              // midpoint of a pinch never holds still, so folding rotation in
              // here makes the stack squirm while you are trying to frame it.
              const zoom = clamp(
                anchor.current.zoom * (separation / anchor.current.pinch),
                MIN_ZOOM,
                MAX_ZOOM
              );
              setView({
                ...viewRef.current,
                zoom,
                // Zoom and pan in one solve, about the fingers' midpoint — see
                // `pinchPan`. Scaling and sliding were separate terms before,
                // and the missing piece was that a zoom about the middle of the
                // stage moves everything the fingers are not on top of: the
                // thing you pinched grew *and* walked away, and the slide term
                // could only be the distance the hand itself had travelled.
                //
                // The midpoint rather than `gesture.dx/dy`, which is the same
                // quantity in increments and cannot say where the gesture is on
                // the stage — which is the half this needs.
                pan: pinchPan(
                  anchor.current,
                  anchor.current.focal,
                  midpoint(touches[0]!, touches[1]!, centre.current),
                  zoom
                ),
              });
            }
            return;
          }
          setView({
            ...viewRef.current,
            yaw: clamp(
              anchor.current.yaw +
                (gesture.dx - anchor.current.dx) * ORBIT_SENSITIVITY,
              -MAX_ORBIT,
              MAX_ORBIT
            ),
            // Negated, unlike `yaw`, because the two CSS rotations do not
            // agree on which way is positive: `rotateY` is positive when the
            // right edge swings away, but `rotateX` is positive when the *top*
            // edge swings away. Passing `dy` straight through gave one finger
            // two opposite senses — drag right and the stack turned with the
            // finger, drag down and it turned against it.
            pitch: clamp(
              anchor.current.pitch -
                (gesture.dy - anchor.current.dy) * ORBIT_SENSITIVITY,
              -MAX_ORBIT,
              MAX_ORBIT
            ),
          });
        },
      }),
    []
  );

  /** Start a new gesture phase from the current view. See {@link anchor}. */
  function reanchor(
    event: GestureResponderEvent,
    gesture: PanResponderGestureState
  ): void {
    const touches = event.nativeEvent.touches;
    fingers.current = touches.length;
    const pair = touches.length >= 2;
    anchor.current = {
      ...viewRef.current,
      dx: gesture.dx,
      dy: gesture.dy,
      pinch: pair ? touchDistance(touches[0]!, touches[1]!) : 0,
      // The point the zoom holds still for this phase. Re-taken with the rest of
      // the anchor, so lifting a finger and pinching again zooms about wherever
      // the fingers went down that time rather than about where they first did.
      focal: pair ? midpoint(touches[0]!, touches[1]!, centre.current) : ORIGIN,
    };
  }

  /**
   * The rectangle the whole scene is drawn relative to — the focused view's
   * frame, or the screen. See `./focus` for why focus re-frames rather than
   * filters.
   */
  const origin = useMemo(() => frameOf(snapshot, focus), [snapshot, focus]);

  // Group the nodes onto their plane once, rather than filtering the whole array
  // once per plane — which is O(planes × nodes) and shows up immediately on a
  // real tree.
  //
  // Bucketed by assigned plane rather than by `node.depth`: two views can share a
  // depth *and* a rectangle, and drawing those on one sheet is an overlap no
  // amount of spread can pull apart. See `./planes`.
  // Every plane in the focus is bucketed, whatever the depth setting says.
  // Depth is applied at render, below, so moving it never re-groups anything.
  const { start, end } = subtreeRange(snapshot.nodes, focus);
  /**
   * Plane the focus is rooted on. Planes are numbered across the whole capture,
   * so a focused subtree starts at whatever its root landed on and everything
   * here is re-based off this.
   *
   * Re-based rather than re-running `assignPlanes` over the slice: the
   * collisions that decided those numbers are the same collisions, and
   * re-solving them for a subset would let a focused view sit on a different
   * sheet than it does unfocused.
   */
  const base = planes[start] ?? 0;

  const sheets = useMemo(() => {
    const byPlane: PlacedNode[][] = [];
    for (let index = start; index < end; index++) {
      const node = snapshot.nodes[index]!;
      // Zero-area views have nothing to draw and nothing to tap — they stay in
      // the tree list, which is where they're still worth seeing.
      if (node.width <= 0 || node.height <= 0) continue;
      const plane = Math.max(0, (planes[index] ?? node.depth) - base);
      (byPlane[plane] ??= []).push({
        node,
        index,
        // Resolved once here rather than per sheet per render: it is the same
        // answer every frame, and it decides how the box is drawn rather than
        // whether it is. See `OFF_SCREEN_FADE`.
        //
        // Still measured against the screen while focused, not against the
        // focus: a row scrolled out of view is scrolled out of view whatever you
        // have narrowed the picture to.
        onScreen: isOnScreen(node, snapshot),
        // The focus root always, whatever its frame reports, so the stack is
        // never entirely anonymous.
        named: index === start || coversFrame(node, origin),
      });
    }
    for (let plane = 0; plane <= maxDepth; plane++) byPlane[plane] ??= [];
    return byPlane;
    // `origin`, `start`, `end` and `base` are all derived from the three below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, planes, focus, maxDepth]);

  /**
   * Frontmost plane actually drawn — the depth setting, or the capture's own
   * floor if it is shallower.
   *
   * Depth cuts rather than fades. Sheets past it were ghosted for a while, to
   * stop the picture and the list disagreeing about which views exist; that was
   * the wrong control to fix it with. Every other faded thing in this tab is the
   * tab saying something the user did not ask about — a sheet far away, a frame
   * off the captured screen — while depth is a knob they just turned. It does
   * not need to explain itself, and a stack of ghosts is exactly the visual
   * noise the knob was reached for to remove.
   */
  const far = Math.min(depth.to, maxDepth);
  const near = Math.min(depth.from, far);

  /**
   * Fit the frame into the stage — dp on the stage per captured dp, *before*
   * zoom. See `STAGE_MARGIN` for the shortfall.
   *
   * This is the scene's own unit, and the one the depths are already in: the
   * spread between sheets, the pivot and `frameStack` all work here, so that
   * zoom stays a single multiplier applied to a finished picture rather than a
   * term to remember in each of them. `../projection` has the derivation, and
   * the concertina it is there to stop.
   */
  const frameFit = useMemo(() => {
    if (!box.width || !box.height || !origin.width || !origin.height) return 0;
    return (
      Math.min(box.width / origin.width, box.height / origin.height) *
      STAGE_MARGIN
    );
  }, [box, origin.width, origin.height]);

  /** What the sheets are actually drawn at. */
  const fit = frameFit * view.zoom;

  /**
   * What the stack turns around.
   *
   * Two answers, in order, and neither asks for anything the user has not
   * already done:
   *
   * 1. **The selected view.** You picked it because it is what you are looking
   *    at, so it is what an orbit should hold still. Its own plane sets the
   *    pivot's depth too, so the box stays put on screen while everything turns
   *    around it, rather than sliding as the stack swings.
   * 2. **Nothing selected — so whatever is in the middle of the stage.** The
   *    scene is translated by `pan`, so the point at the centre of the stage
   *    sits at `(−pan.x, −pan.y)` in the projection's own space. No extra state,
   *    and it is exactly what was missing before: zoom into a corner and orbit,
   *    and the corner swung away because the stack was still turning around a
   *    middle that had left the screen.
   *
   * A focused subtree needs no case of its own — focusing selects its root.
   */
  const pivot = useMemo((): Pivot => {
    // In the scene's dp, like everything else the projection is handed — so the
    // pan, which is a screen offset applied to the magnified picture, comes back
    // through the zoom to say which scene point the stage is centred on.
    const viewport = {
      ...CENTRE,
      x: -view.pan.x / view.zoom,
      y: -view.pan.y / view.zoom,
    };
    if (selected == null || selected < start || selected >= end)
      return viewport;
    const node = snapshot.nodes[selected];
    // Zero-area views are not drawn, so there is no box on screen to hold still.
    if (!node || node.width <= 0 || node.height <= 0) return viewport;
    const plane = clamp(
      Math.max(0, (planes[selected] ?? node.depth) - base),
      near,
      far
    );
    return {
      // The view's centre as an offset from the sheet's centre. Sheets are
      // centred on the stage, so that offset *is* the projection's x and y.
      x:
        (node.left + node.width / 2 - origin.left - origin.width / 2) *
        frameFit,
      y:
        (node.top + node.height / 2 - origin.top - origin.height / 2) *
        frameFit,
      z: -(far - plane) * spread,
    };
    // `origin`, `start`, `end` and `base` all derive from what is listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected,
    snapshot,
    planes,
    focus,
    near,
    far,
    spread,
    frameFit,
    view.pan,
    view.zoom,
  ]);

  // The fade is normalised against the two ends of the stack rather than against
  // an absolute curve, so the whole brightness range is spent across however many
  // planes are on screen. Both ends are measured, because with a pivot off the
  // stack's axis the frontmost sheet is no longer necessarily at scale 1.
  // No zoom passed: the divisor does not move with it — magnifying the scene
  // moves the lens back by as much — so the stack fades the same close up as far
  // out, which is what a magnifier should do.
  const frontScale = projectPlane(0, orbit, pivot).scale;
  const backScale = projectPlane((far - near) * spread, orbit, pivot).scale;

  /**
   * The toggle: square on, or turned and framed.
   *
   * Turning is not just an orbit. At the preset angle the sheets fan left and up,
   * so the stack ends up both bigger than the stage and no longer centred on it —
   * left alone it hugs the left edge with the right half of the stage empty. So
   * the toggle re-frames as well as turns, which it can do precisely because it
   * is a discrete move: `frameStack` solves the zoom and pan that put the whole
   * stack on the stage, and doing that on every frame of a drag would make the
   * picture breathe under the finger.
   *
   * Going back needs none of it. Square on there is nothing to fit — the stack is
   * the screen — so `HOME` is the answer as written.
   */
  const toggleView = useCallback((): void => {
    if (isMoved(viewRef.current)) {
      setView(HOME);
      return;
    }
    const zBacks: number[] = [];
    for (let plane = near; plane <= far; plane++) {
      zBacks.push((far - plane) * spread);
    }
    const framed = frameStack(
      zBacks,
      ANGLED,
      { width: origin.width * frameFit, height: origin.height * frameFit },
      box,
      pivot
    );
    setView({
      ...ANGLED,
      zoom: clamp(framed.zoom, MIN_ZOOM, MAX_ZOOM),
      pan: framed.pan,
    });
  }, [near, far, spread, origin.width, origin.height, frameFit, box, pivot]);

  /**
   * Focus resets the camera, unfocusing puts it back.
   *
   * Two different intents, and each gets what it asked for. Entering a focus is
   * "show me this thing" — an orbit and a zoom chosen to frame the whole screen
   * are meaningless against a card, and often leave the card off stage entirely.
   * Leaving one is "put it back the way it was", and losing the angle you had
   * spent a minute finding is the kind of thing that stops people using a view
   * they can get out of.
   */
  const beforeFocus = useRef<Camera | null>(null);
  useEffect(() => {
    if (focus != null) {
      beforeFocus.current = viewRef.current;
      setView(HOME);
    } else if (beforeFocus.current) {
      setView(beforeFocus.current);
      beforeFocus.current = null;
    }
  }, [focus]);

  // One tap selects, two focus. Held here rather than in `Box` so the pair
  // survives crossing between boxes — see `./use-double-tap`.
  const tap = useDoubleTap(onSelect, onFocus);

  return (
    <View
      ref={stage}
      onLayout={onLayout}
      style={[styles.stage, { backgroundColor: theme.surfaceRaised }]}
      {...responder.panHandlers}
    >
      {/* Tap on nothing clears the selection.
          
          A backdrop rather than a handler on the stage, because the stage also
          carries the pan responder and the two would fight over the same touch.
          Behind everything, so a tap that hits a box is taken by the box: the
          plane groups are `box-none`, so only taps that miss every frame reach
          this. A drag is still orbit — the stage claims the gesture on movement
          and this releases it.
          
          This is where deselect went when the second tap on a box was freed up
          for focus, and it is the better home for it anyway: "tap away from the
          thing" is what every other selection on a screen means. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel={strings.viewHierarchyClearSelection}
      />

      {/* The camera pan. One translation around the whole stack rather than a
          term inside each plane's projection: moving the beholder must not change
          how the sheets sit relative to each other, and anything applied per-plane
          would. */}
      <View
        pointerEvents="box-none"
        style={[
          StyleSheet.absoluteFill,
          {
            transform: [{ translateX: view.pan.x }, { translateY: view.pan.y }],
          },
        ]}
      >
        {fit > 0
          ? // Ascending depth, so the root paints first and sits at the back — and
            // the deepest sheet, drawn last, is both frontmost and the one that
            // wins a tap. Same rule as the native pick: deepest view under the
            // finger.
            sheets.slice(near, far + 1).map((nodes, offset) => {
              const plane = near + offset;
              return (
                <Plane
                  key={plane}
                  nodes={nodes}
                  origin={origin}
                  fit={fit}
                  zoom={view.zoom}
                  // The backmost sheet *drawn* carries the outline, not plane 0.
                  // With the back of the stack cut away there would otherwise be
                  // no rectangle saying where the screen edges are — and it is the
                  // same rectangle on any sheet, since they are all sized to
                  // `origin`.
                  framed={plane === near}
                  // Only the capture's root sheet goes unfilled, and that is
                  // about the root being full-bleed — filling it paints the
                  // whole rectangle solid and every sheet in front reads against
                  // a slab. `plane` is re-based on the focus, so it reads 0 for
                  // whatever subtree you are in; adding `base` back asks the
                  // question that was meant, and a focused card keeps its fill.
                  filled={plane + base !== 0}
                  // Distance behind the frontmost sheet. Plane 0 is furthest away,
                  // which is how Xcode and Safari both order it.
                  //
                  // Anchored on the deepest sheet *drawn*, so the front of the
                  // stack stays put as depth comes down and the stack shortens
                  // behind it. Anchored on the capture's deepest instead, trimming
                  // the front would leave the gap it vacated and slide the whole
                  // stack away from the camera.
                  zBack={(far - plane) * spread}
                  pivot={pivot}
                  frontScale={frontScale}
                  backScale={backScale}
                  orbit={orbit}
                  selected={selected}
                  onSelect={tap}
                />
              );
            })
          : null}
      </View>

      {/* The stage's one control: square on, or turned.
          
          It was a reset button that appeared once the camera had moved. Two
          things were wrong with that. It was only ever half a control — it could
          bring you back but never take you anywhere — so the angle that makes
          the sheets separate, which is the whole reason the stack is drawn in 3D,
          was reachable only by knowing to drag. And a control that comes and goes
          is one you cannot learn: it is absent exactly when you are looking for
          something to press.
          
          As a toggle it is always there and does both jobs. `isMoved` still
          decides which: square on, it turns the stack; anywhere else — the
          preset angle or an orbit you dragged yourself — it brings you back. So
          "reset" did not disappear, it became the return half of a round trip.
          
          Depth and Spread went to the bar below — see `./Slider` — where they
          have the width a slider needs and no orbit gesture underneath to fight.
          Zoom has no button: pinch covers it, and a target in a corner this small
          buys less than it crowds out.
          
          Taps reach it because the stage's responder claims the gesture on
          movement, not on touch-down. */}
      <View style={styles.controls}>
        <Pressable
          onPress={toggleView}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={
            isMoved(view)
              ? strings.viewHierarchyReset
              : strings.viewHierarchyAngle
          }
          style={styles.reset}
        >
          <Icon
            name={isMoved(view) ? 'layers' : 'grid-outline'}
            size={15}
            color={theme.textMuted}
            background={theme.surfaceRaised}
          />
        </Pressable>
      </View>
    </View>
  );
}

/** Screen distance between two active touches — the pinch measurement. */

function touchDistance(a: NativeTouchEvent, b: NativeTouchEvent): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/**
 * Where two touches are centred, as an offset from the centre of the stage —
 * the frame `pan` is in, and the frame the zoom has to be anchored in.
 */
function midpoint(
  a: NativeTouchEvent,
  b: NativeTouchEvent,
  stage: { x: number; y: number }
): { x: number; y: number } {
  return {
    x: (a.pageX + b.pageX) / 2 - stage.x,
    y: (a.pageY + b.pageY) / 2 - stage.y,
  };
}

/** Stand-in focal point while fewer than two fingers are down. Never read. */
const ORIGIN = { x: 0, y: 0 };

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  reset: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  controls: {
    position: 'absolute',
    right: space.xs,
    top: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
});
