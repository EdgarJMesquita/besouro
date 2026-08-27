/**
 * One depth level of the stack: a sheet, and every view that landed on it.
 *
 * The sheet is where the projection is applied — `../projection` derives it. What
 * is drawn on the sheet is `Box`.
 */

import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useBesouroUI } from '../../../shared/context';
import {
  PERSPECTIVE,
  projectPlane,
  type Orbit,
  type Pivot,
} from '../projection';
import type { Frame } from '../utils/focus';
import type { PlacedNode } from '../types';
import { Box } from './Box';

/** Floor on the distance fade, so the back of a deep stack dims but never vanishes. */
const MIN_FADE = 0.3;

/**
 * What a view outside the captured screen keeps of its strength.
 *
 * These are drawn now, where the sheets used to clip them away. Clipping was the
 * honest reading of a sheet — it is the screen, and the screen shows what fits —
 * but it left the tab contradicting itself: the list below offered rows the
 * picture had no box for, and a ScrollView's rows are most of a real tree. The
 * frames are real geometry the capture already has, so the stack draws them and
 * the screen outline on the back sheet says where the visible part ends.
 *
 * Faint rather than full, because they are context: a run of scrolled-away rows
 * is taller than the screen it hangs off, and at equal strength it out-weighs the
 * thing actually being inspected. This is the same distinction the tree list
 * makes with its own dimming, so the two halves now agree on every view.
 */
const OFF_SCREEN_FADE = 0.4;

export /**
 * Memoized. Its geometry props move together on a camera or knob change, so it
 * redraws then and skips everything else — a selection, a refresh, a scroll of
 * the tree beside it.
 */
const Plane = memo(function PlaneSheet({
  nodes,
  origin,
  fit,
  framed,
  filled,
  zBack,
  pivot,
  frontScale,
  backScale,
  orbit,
  selected,
  onSelect,
}: {
  nodes: PlacedNode[];
  /** The rectangle a sheet represents — the screen, or the focused view. */
  origin: Frame;
  fit: number;
  /** Draw the screen outline on this sheet. True for exactly one — see below. */
  framed: boolean;
  /** Give this sheet's views a body. False on the root sheet — see `Box`. */
  filled: boolean;
  zBack: number;
  /** What the stack turns around — see the pivot in {@link Exploded}. */
  pivot: Pivot;
  /** Projected scale of the nearest sheet — the near end of the fade range. */
  frontScale: number;
  /** Projected scale of the furthest sheet — the far end of the fade range. */
  backScale: number;
  orbit: Orbit;
  selected: number | null;
  onSelect: (index: number) => void;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const { translateX, translateY, scale } = projectPlane(zBack, orbit, pivot);
  // Aerial perspective — the depth cue that survives having no fills on the
  // sheets themselves. `scale` is already the physical measure of how far away a
  // sheet is, so the fade rides on it.
  //
  // Normalised across the stack's *actual* scale range rather than applied as an
  // absolute curve, because an absolute one collapses. Cubing `scale` and
  // clamping at MIN_FADE meant that with a deep stack every sheet past roughly
  // the halfway point landed on the floor: depths 0–5 all rendered at exactly
  // 0.30, so six identical full-screen rectangles overlapping ~85% had nothing
  // left to tell them apart and fused into one slab. Mapping the front sheet to
  // 1 and the furthest to MIN_FADE spends the whole range no matter how many
  // planes are on screen or how far apart they are.
  const span = frontScale - backScale;
  const nearness =
    span > 0 ? MIN_FADE + (1 - MIN_FADE) * ((scale - backScale) / span) : 1;

  return (
    <View
      pointerEvents="box-none"
      style={[
        StyleSheet.absoluteFill,
        styles.center,
        // The sheets have to overlap in the same space to stack, so they all fill
        // the stage and place themselves with transforms.
        { transform: [{ translateX }, { translateY }] },
      ]}
    >
      <View
        // This group exists for the projection, not for looks: one 3D transform
        // on a parent projects every view at this depth through a *single*
        // vanishing point. Give each box its own transform instead and each gets
        // its own vanishing point, and the sheet stops being a plane.
        //
        // So it draws nothing — except on the back sheet, which carries the
        // screen outline. That one rectangle is the only invented thing on
        // screen, and it earns its place now that the full-bleed views are
        // unfilled (see `Box`): without it the stack floats with no indication of
        // where the screen edges are.
        //
        // `box-none` keeps this group off the hit path: it is root-sized, and a
        // transparent RN view still swallows touches inside its bounds, so
        // without it the frontmost sheet eats every tap that misses one of its
        // own boxes and nothing behind is reachable.
        pointerEvents="box-none"
        style={{
          width: origin.width * fit,
          height: origin.height * fit,
          borderWidth: framed ? StyleSheet.hairlineWidth : 0,
          borderColor: theme.border,
          backgroundColor: 'transparent',
          // Deliberately unclipped. The sheet is sized to the screen and
          // outlined on the back plane, but it does not cut: a ScrollView
          // reports absolute frames for its whole scrollable extent, and those
          // rows trailing above and below the outline are the capture's real
          // geometry rather than an artefact. They are drawn faint instead —
          // see `OFF_SCREEN_FADE`. The stage is what bounds the picture.
          //
          // Those boxes stay tappable on both platforms, which is not what plain
          // Android would do — `ViewGroup.dispatchTouchEvent` clips to the
          // parent. React Native does its own hit-testing instead
          // (`TouchTargetHelper`), and only rejects an out-of-bounds touch when
          // `overflow` is hidden/scroll or `clipChildren` is set; `visible`
          // clears both, and RN extends the hit area by the union of the
          // children's bounds. Verified on device.
          overflow: 'visible',
          transform: [
            // Perspective first in the list = outermost = applied to the
            // rotations below it, foreshortening the sheet within itself.
            { perspective: PERSPECTIVE },
            { rotateX: `${orbit.pitch}deg` },
            { rotateY: `${orbit.yaw}deg` },
            // The projected size of a plane at this depth. Computed, not guessed:
            // this is the `translateZ` RN won't give us.
            { scale },
          ],
        }}
      >
        {nodes.map(({ node, index, onScreen, named }) => (
          <Box
            key={index}
            node={node}
            origin={origin}
            fit={fit}
            nearness={nearness * (onScreen ? 1 : OFF_SCREEN_FADE)}
            named={named}
            filled={filled}
            selected={index === selected}
            index={index}
            onPress={onSelect}
          />
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
