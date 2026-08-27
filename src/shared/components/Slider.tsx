/**
 * Sliders, drawn and driven here rather than installed.
 *
 * React Native dropped `Slider` from core, and this library has no dependencies
 * at all — its `peerDependencies` are react and react-native and nothing else.
 * Adding `@react-native-community/slider` would make a devtool the reason a host
 * app gains a native module, which is a bad trade for a control that is a track,
 * a thumb and some arithmetic. It also ships no range variant, which is half of
 * what this file needs.
 *
 * ## Why sliders and not the buttons they replaced
 *
 * Both knobs are judged by *what the stack looks like*, not by the number they
 * hold — which is why neither shows one. A stepper makes you sample that picture
 * one tap at a time; a slider lets you sweep the range and stop where it reads
 * best, which is the actual way anyone uses these. It is what Xcode's view
 * debugger puts under its canvas for exactly the same two controls.
 *
 * The cost is horizontal room, which is why these live in a bar under the stage
 * rather than in the corner the steppers occupied: a drag target inside the
 * stage would also be fighting the orbit gesture underneath it.
 */

import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from 'react-native';
import { useBesouroUI } from '../context';
import { radius, space } from '../../theme/tokens';

/** Diameter of the thumb, and so the part of the track it cannot reach past. */
const THUMB = 14;
const TRACK = 3;

type Bounds = { min: number; max: number; step: number };

/** One thumb, one value. */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  accessibilityLabel,
}: Bounds & {
  value: number;
  onChange: (next: number) => void;
  accessibilityLabel: string;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const [width, setWidth] = useState(0);

  // Read by the responder, which is built once and would otherwise close over
  // the first render's numbers forever.
  const state = useRef({ width, min, max, step, onChange });
  state.current = { width, min, max, step, onChange };
  /** Where the drag started, as a position along the track. */
  const from = useRef(0);

  const responder = useMemo(
    () =>
      PanResponder.create({
        ...claimEagerly,
        onPanResponderGrant: (event: GestureResponderEvent) => {
          from.current = touchAt(event);
          emitFrom(state.current, from.current);
        },
        onPanResponderMove: (
          _event: GestureResponderEvent,
          gesture: PanResponderGestureState
        ) => emitFrom(state.current, from.current + gesture.dx),
      }),
    []
  );

  const at = thumbAt(value, width, { min, max });
  return (
    <View
      onLayout={onLayout(setWidth)}
      style={styles.hit}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      {...responder.panHandlers}
    >
      <Rails theme={theme} from={0} to={at} />
      <Thumb theme={theme} at={at} />
    </View>
  );
}

function emitFrom(
  state: Bounds & { width: number; onChange: (next: number) => void },
  x: number
): void {
  state.onChange(valueAt(x, state.width, state));
}

/**
 * Two thumbs — a window into the range, closed from either end.
 *
 * Depth needs both. Cutting only the front answers "show me less of the app's
 * own tree", which is most of what you want; but a capture opens with a run of
 * full-bleed chrome nobody is inspecting — window, root view, content view, the
 * ScrollView stack — and that sits at the *back*. A single-ended control could
 * never be rid of it, so every picture began with several identical rectangles
 * behind the thing actually being looked at.
 */
export function RangeSlider({
  low,
  high,
  min,
  max,
  step,
  onChange,
  accessibilityLabel,
}: Bounds & {
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  accessibilityLabel: string;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const [width, setWidth] = useState(0);

  const state = useRef({ width, low, high, min, max, step, onChange });
  state.current = { width, low, high, min, max, step, onChange };
  /** Which thumb the gesture grabbed, and where it started. */
  const drag = useRef({ upper: false, from: 0 });

  const responder = useMemo(() => {
    function emit(x: number): void {
      const now = state.current;
      const next = valueAt(x, now.width, now);
      // The thumbs push each other rather than blocking. Dragging one into the
      // other and having it stop dead is the interaction people expect to fail;
      // instead the window closes to nothing and opens again the other way.
      if (drag.current.upper) now.onChange(Math.min(now.low, next), next);
      else now.onChange(next, Math.max(now.high, next));
    }

    return PanResponder.create({
      ...claimEagerly,
      onPanResponderGrant: (event: GestureResponderEvent) => {
        const now = state.current;
        const x = touchAt(event);
        // Whichever thumb is nearer, measured in px rather than in value, so a
        // pair pinned together at one end still splits by which side you touched.
        const toLow = Math.abs(x - thumbAt(now.low, now.width, now));
        const toHigh = Math.abs(x - thumbAt(now.high, now.width, now));
        drag.current = { upper: toHigh <= toLow, from: x };
        emit(x);
      },
      onPanResponderMove: (
        _event: GestureResponderEvent,
        gesture: PanResponderGestureState
      ) => emit(drag.current.from + gesture.dx),
    });
  }, []);

  const bounds = { min, max, step };
  const lowAt = thumbAt(low, width, bounds);
  const highAt = thumbAt(high, width, bounds);
  return (
    <View
      onLayout={onLayout(setWidth)}
      style={styles.hit}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: high }}
      {...responder.panHandlers}
    >
      <Rails theme={theme} from={lowAt} to={highAt} />
      <Thumb theme={theme} at={lowAt} />
      <Thumb theme={theme} at={highAt} />
    </View>
  );
}

/**
 * The track, and the stretch of it the value covers.
 *
 * `pointerEvents="none"` throughout, and that is load-bearing rather than tidy.
 * `locationX` is measured against whichever node the touch landed on, so a press
 * that started on a thumb reported a few px — the offset inside the thumb — and
 * the value snapped to the minimum. Grabbing a thumb, the one gesture a slider
 * exists for, was the one that broke. Taking the children off the hit path makes
 * the container the target for every touch, so `locationX` is always a position
 * along the track.
 */
function Rails({
  theme,
  from,
  to,
}: {
  theme: { border: string; accent: string };
  from: number;
  to: number;
}): React.ReactNode {
  return (
    <>
      <View
        pointerEvents="none"
        style={[styles.track, { backgroundColor: theme.border }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.track,
          styles.covered,
          {
            backgroundColor: theme.accent,
            left: THUMB / 2 + from,
            width: Math.max(0, to - from),
          },
        ]}
      />
    </>
  );
}

function Thumb({
  theme,
  at,
}: {
  theme: { accent: string };
  at: number;
}): React.ReactNode {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.thumb,
        { backgroundColor: theme.accent, transform: [{ translateX: at }] },
      ]}
    />
  );
}

/**
 * Claimed on touch-down, unlike the stage's camera responder: a slider *is* the
 * control, so there is nothing underneath it to yield to, and a tap should land
 * the thumb rather than wait to see whether it becomes a drag.
 */
const claimEagerly = {
  onStartShouldSetPanResponder: () => true,
  onMoveShouldSetPanResponder: () => true,
};

/**
 * Travel available to a thumb's *centre*. The track is inset by half a thumb at
 * each end so a thumb never overhangs it.
 */
function travel(width: number): number {
  return Math.max(1, width - THUMB);
}

/** Where a touch landed, as a position along the travel. */
function touchAt(event: GestureResponderEvent): number {
  return event.nativeEvent.locationX - THUMB / 2;
}

/** Position along the travel → value, snapped and clamped. */
function valueAt(x: number, width: number, { min, max, step }: Bounds): number {
  const ratio = Math.min(1, Math.max(0, x / travel(width)));
  const raw = min + ratio * (max - min);
  const snapped = step > 0 ? Math.round(raw / step) * step : raw;
  return Math.min(max, Math.max(min, snapped));
}

/** Value → position along the travel. */
function thumbAt(
  value: number,
  width: number,
  { min, max }: { min: number; max: number }
): number {
  const ratio = max > min ? (value - min) / (max - min) : 0;
  return Math.min(1, Math.max(0, ratio)) * Math.max(0, width - THUMB);
}

function onLayout(set: (width: number) => void) {
  return (event: LayoutChangeEvent): void =>
    set(event.nativeEvent.layout.width);
}

const styles = StyleSheet.create({
  // Taller than what it draws: a 3px track is an impossible target, and the
  // padding is the difference between a control you can grab and one you poke at.
  hit: {
    flex: 1,
    height: THUMB + space.md,
    justifyContent: 'center',
  },
  track: {
    height: TRACK,
    borderRadius: radius.sm,
    marginHorizontal: THUMB / 2,
  },
  // The covered stretch, positioned rather than laid out.
  covered: {
    position: 'absolute',
    marginHorizontal: 0,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
  },
});
