/**
 * The drawer's motion: the slide in on mount, the slide out on close, and the
 * swipe that lets the user push it off-screen by hand.
 *
 * The three belong together because they write the same two values. A swipe that
 * ends past the threshold does not restart the close from scratch — it hands the
 * closing animation the position the finger left the drawer at, so the drawer
 * carries on from under the thumb instead of jumping back and re-playing.
 *
 * Built on `PanResponder` + `Animated`, for the same reason as the tab strip's
 * reorder (see `tab-strip.ts`): the library ships with no dependencies beyond its
 * `react`/`react-native` peers, so a gesture library is not an option.
 *
 * **The pan belongs to the backdrop, not to the drawer.** Dragging the drawer
 * body would put this responder in competition with everything inside it — every
 * tab's vertical list, the horizontal tab strip, the hold-and-drag reorder — and
 * that competition can only be settled by guessing at a direction and a
 * threshold, which is wrong often enough to make a list feel sticky. The backdrop
 * carries nothing and scrolls nowhere, so a drag there is unambiguous: there is
 * no second thing it could have meant. It is also already the "dismiss" surface —
 * this only gives its tap a continuous form.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  type GestureResponderHandlers,
} from 'react-native';
import { hapticTap } from '../../core/haptics';

const SLIDE_DURATION = 220;
/** How far a finger travels before the swipe claims the touch off the backdrop's tap. */
const CLAIM_DISTANCE = 12;
/**
 * How much more horizontal than vertical that travel must be. Nothing here is
 * competing for the gesture; this only keeps a stray vertical flick across the
 * backdrop from reading as a deliberate push.
 */
const CLAIM_RATIO = 1.2;
/** Released past this much of the drawer's width, it closes rather than settles. */
const CLOSE_FRACTION = 0.4;
/** …or released under it, but flicked at this speed (px/ms). */
const CLOSE_VELOCITY = 0.5;
/**
 * How far back inside the threshold the finger must come before the drag counts
 * as un-armed again. Without a gap, a finger held on the line crosses it back
 * and forth a pixel at a time and rattles the tap once per frame.
 */
const REARM_MARGIN = 0.06;
/** Floor on the shortened close, so a drawer let go near the edge still reads as a slide. */
const MIN_CLOSE_DURATION = 90;

export interface DrawerSlide {
  /** The drawer's own offset: 0 open, `width` fully off-screen right. */
  translateX: Animated.Value;
  /** The dim behind it, 0 → 1, kept in lockstep with the slide. */
  backdropOpacity: Animated.Value;
  /** Play the slide-out from wherever the drawer is, then hand back to `onClose`. */
  close: () => void;
  /** Attach to the backdrop — a rightward drag there pushes the drawer out. */
  panHandlers: GestureResponderHandlers;
}

export function useDrawerSlide({
  width,
  onClose,
}: {
  /** The drawer's width — the distance a full close travels. */
  width: number;
  /** Run once the slide-out finishes; tears the native surface down. */
  onClose: () => void;
}): DrawerSlide {
  const translateX = useRef(new Animated.Value(width)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  /** Guards the slide-out against re-entry (double back press, a tap mid-close). */
  const closing = useRef(false);
  /**
   * Where the drawer is, as far as anything here has put it. Tracked rather than
   * read back off `translateX`: the value is native-driven, and adding a listener
   * to it would put a bridge message on every frame of every slide just to learn
   * something only the release below actually asks for.
   */
  const position = useRef(width);
  /**
   * Whether the drag has passed the point where letting go closes the drawer.
   * The threshold is invisible — the drawer looks the same either side of it —
   * so the tap is the only thing that tells the user their release has changed
   * meaning, and it must fire once per crossing rather than once per frame past.
   */
  const armed = useRef(false);

  // Read through a ref so the responder is built once and still calls the current
  // `onClose` (rebuilt by the shell every render).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  /** Put the drawer at `x` and dim the backdrop to match. */
  const place = useCallback(
    (x: number): void => {
      position.current = x;
      translateX.setValue(x);
      backdropOpacity.setValue(1 - x / width);
    },
    [translateX, backdropOpacity, width]
  );

  const close = useCallback((): void => {
    if (closing.current) {
      return;
    }
    closing.current = true;
    // Only the distance still to cover, at the speed of a full slide: a drawer
    // the user already pushed most of the way out has almost none left, and
    // spending the whole duration on it would feel like it stalled in the hand.
    const remaining = Math.max(0, width - position.current);
    const duration = Math.max(
      MIN_CLOSE_DURATION,
      SLIDE_DURATION * (remaining / width)
    );
    position.current = width;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: width,
        duration,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration,
        useNativeDriver: true,
      }),
    ]).start(() => onCloseRef.current());
  }, [translateX, backdropOpacity, width]);

  /** Take back a swipe that didn't go far enough. */
  const settle = useCallback((): void => {
    position.current = 0;
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 9,
        tension: 90,
      }),
      Animated.spring(backdropOpacity, {
        toValue: 1,
        useNativeDriver: true,
        friction: 9,
        tension: 90,
      }),
    ]).start();
  }, [translateX, backdropOpacity]);

  // Runs once: the drawer is mounted by the native surface when it opens and
  // unmounted when it closes, so its existence *is* its visibility. The backdrop
  // fades on its own value (rather than an interpolation of translateX) so the
  // fade is directly attached to the backdrop's native opacity and can't be
  // dropped.
  useEffect(() => {
    closing.current = false;
    position.current = 0;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: SLIDE_DURATION,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: SLIDE_DURATION,
        useNativeDriver: true,
      }),
    ]).start();
  }, [translateX, backdropOpacity]);

  const panHandlers = useMemo(
    () =>
      PanResponder.create({
        // Never claims a fresh touch, so the backdrop's own press — a tap
        // anywhere on it closes the drawer — still fires. Only once the finger
        // has travelled does this take the touch off it, at which point the
        // press is cancelled and the drag stands in for the tap.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !closing.current &&
          gesture.dx > CLAIM_DISTANCE &&
          gesture.dx > Math.abs(gesture.dy) * CLAIM_RATIO,
        // `PanResponder` zeroes `dx` when it takes the touch, so the drawer picks
        // the finger up where it is rather than jumping the claim distance.
        onPanResponderGrant: () => {
          armed.current = false;
        },
        onPanResponderMove: (_event, gesture) => {
          const x = Math.min(width, Math.max(0, gesture.dx));
          place(x);
          if (!armed.current && x > width * CLOSE_FRACTION) {
            armed.current = true;
            hapticTap();
          } else if (
            armed.current &&
            x < width * (CLOSE_FRACTION - REARM_MARGIN)
          ) {
            // Dragged back: releasing here settles again, so the next crossing
            // is news once more.
            armed.current = false;
          }
        },
        // Once the drawer is following the finger, handing the touch back would
        // strand it half-open with nothing left to close it.
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_event, gesture) => {
          const x = Math.min(width, Math.max(0, gesture.dx));
          armed.current = false;
          // Far enough, or thrown hard enough — a flick shouldn't have to cross
          // the same distance a slow drag does.
          if (x > width * CLOSE_FRACTION || gesture.vx > CLOSE_VELOCITY) {
            position.current = x;
            close();
          } else {
            settle();
          }
        },
        onPanResponderTerminate: () => {
          armed.current = false;
          settle();
        },
      }).panHandlers,
    [place, settle, close, width]
  );

  return { translateX, backdropOpacity, close, panHandlers };
}
