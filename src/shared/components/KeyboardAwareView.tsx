/**
 * Lifts its content above the on-screen keyboard by animating a matching amount
 * of bottom padding, driven purely by react-native's `Keyboard` events (zero
 * extra dependencies).
 *
 * Works on both platforms so behaviour is identical: wrap a scroll/list
 * container with it and the viewport shrinks by the keyboard height, keeping a
 * focused input (and the rows below it) reachable while the keyboard is up.
 * iOS animates from the `will`-events (in step with the system slide); Android
 * only emits `did`-events, so it eases in with a matching duration.
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  Keyboard,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

interface KeyboardAwareViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

// Fallback when a keyboard event omits its animation duration (Android often
// reports 0); keeps the padding change from snapping.
const FALLBACK_DURATION = 150;

export function KeyboardAwareView({
  children,
  style,
}: KeyboardAwareViewProps): React.ReactNode {
  const paddingBottom = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animateTo = (toValue: number, duration?: number): void => {
      Animated.timing(paddingBottom, {
        toValue,
        duration: duration || FALLBACK_DURATION,
        // paddingBottom is a layout prop — the native driver can't animate it.
        useNativeDriver: false,
      }).start();
    };

    // iOS emits `will`-events that fire alongside the system slide; Android only
    // has `did`-events. Picking per-platform keeps the padding in step with the
    // keyboard on iOS without firing twice on Android.
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      animateTo(e.endCoordinates.height, e.duration);
    });
    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      animateTo(0, e?.duration);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [paddingBottom]);

  return (
    <Animated.View style={[{ flex: 1 }, style, { paddingBottom }]}>
      {children}
    </Animated.View>
  );
}
