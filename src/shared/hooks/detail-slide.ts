/**
 * The right-to-left slide shared by the drawer and every detail overlay.
 * Lives on its own (rather than inside `DetailOverlay`) because the drawer
 * uses the same motion without being a detail — see `BesouroShell`.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Animated, Dimensions } from 'react-native';

// Detail views travel the full window width so they clear the viewport
// regardless of the drawer's measured size. Duration matches the drawer.
const DETAIL_TRAVEL = Dimensions.get('window').width;
const DETAIL_SLIDE_DURATION = 220;

/**
 * The returned `translateX` starts off-screen and animates in on mount;
 * `requestClose` reverses the same motion and, once it finishes, runs `onClose`
 * (typically to unmount). Guards against double-triggering so back + button
 * presses can't race.
 *
 * Pass `animateIn: false` for a view that appears without the user having done
 * anything — a detail restored from ephemeral state when its tab remounts (see
 * {@link useDetailEntrance}). It then starts already in place, and only the
 * slide-out plays. The flag is read once, at mount; the close is unaffected.
 */
export function useDetailSlide(
  onClose: () => void,
  animateIn = true
): {
  translateX: Animated.Value;
  requestClose: () => void;
} {
  const animateInRef = useRef(animateIn);
  const translateX = useRef(
    new Animated.Value(animateInRef.current ? DETAIL_TRAVEL : 0)
  ).current;
  const closingRef = useRef(false);

  useEffect(() => {
    if (!animateInRef.current) {
      return;
    }
    Animated.timing(translateX, {
      toValue: 0,
      duration: DETAIL_SLIDE_DURATION,
      useNativeDriver: true,
    }).start();
  }, [translateX]);

  const requestClose = useCallback((): void => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    Animated.timing(translateX, {
      toValue: DETAIL_TRAVEL,
      duration: DETAIL_SLIDE_DURATION,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [translateX, onClose]);

  return { translateX, requestClose };
}

/**
 * Whether a detail gated on `selection` should animate its entrance — the
 * `animateIn` argument to {@link useDetailSlide} / {@link DetailOverlay}.
 *
 * Tab selections live in the ephemeral store, which outlives both a tab switch
 * and the surface being torn down, so a tab can mount with its detail
 * already open. Sliding it in then looks like motion out of nowhere: nobody
 * touched anything. Call this in the *tab* — the overlay unmounts with it, so it
 * can't remember anything across the restore itself.
 *
 * Compares by identity, so an object selection works as long as the store hands
 * back the same reference — which `core/ephemeral-state` guarantees.
 */
export function useDetailEntrance<T>(selection: T | null): boolean {
  // Whatever was selected at mount came back from the store, not from a tap.
  const restored = useRef(selection);
  // Closing the detail spends that baseline: from here on every selection is the
  // user's doing, including re-picking the row that had been restored.
  if (selection === null) {
    restored.current = null;
  }
  return selection !== null && selection !== restored.current;
}
