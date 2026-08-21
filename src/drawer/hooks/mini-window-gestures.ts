/**
 * The two gestures that shape the floating panel: dragging it by its header and
 * resizing it from its corner grip.
 *
 * Both are unusual in the same way — they move the surface the touch is being
 * reported *from*. React sees `pageX/pageY` relative to the panel's own origin,
 * and that origin is what the gesture is changing, so a naive delta feeds itself.
 * Each responder below cancels that out differently, and the comments say how.
 *
 * They live apart from the shell because they are the only stateful thing about
 * the minimized presentation; the shell just spreads their handlers onto the
 * header and the grip.
 */

import { useMemo, useRef } from 'react';
import { PanResponder, type GestureResponderEvent } from 'react-native';
import { getPanelFrame, savePanelFrame, setPanelFrame } from '../mini-window';

/**
 * How far a finger must travel before the panel starts moving. Below it the
 * touch belongs to whatever it landed on — the header carries the restore and
 * close buttons, and a drag that claimed the gesture on touch-down would eat
 * every tap on them.
 */
const DRAG_THRESHOLD = 4;

function travelled(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD;
}

export interface MiniWindowGestures {
  /** Spread onto the panel's header. */
  dragHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
  /** Spread onto the panel's resize grip. */
  resizeHandlers: ReturnType<typeof PanResponder.create>['panHandlers'];
}

export function useMiniWindowGestures(): MiniWindowGestures {
  // ── Drag ────────────────────────────────────────────────────────────────
  // Anchored on where inside the header the finger landed. Re-deriving the
  // origin from that offset each event is self-correcting: if the panel is where
  // the finger expects it, the offset is unchanged and the origin holds; if it
  // lagged, the difference is exactly the correction to apply.
  const grabOffset = useRef({ x: 0, y: 0 });

  const drag = useMemo(
    () =>
      PanResponder.create({
        // Never on touch-down — see DRAG_THRESHOLD.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) =>
          travelled(gesture.dx, gesture.dy),
        onPanResponderGrant: (event: GestureResponderEvent) => {
          grabOffset.current = {
            x: event.nativeEvent.pageX,
            y: event.nativeEvent.pageY,
          };
        },
        onPanResponderMove: (event: GestureResponderEvent) => {
          const current = getPanelFrame();
          setPanelFrame({
            ...current,
            x: current.x + (event.nativeEvent.pageX - grabOffset.current.x),
            y: current.y + (event.nativeEvent.pageY - grabOffset.current.y),
          });
        },
        // Once the finger is off: a gesture's worth of intermediate positions is
        // not worth a file write each.
        onPanResponderRelease: savePanelFrame,
        onPanResponderTerminate: savePanelFrame,
      }),
    []
  );

  // ── Resize ──────────────────────────────────────────────────────────────
  // Measured in screen coordinates, because the origin can move mid-gesture: a
  // panel grown into an edge slides off it, and `pageX/pageY` are relative to
  // that moving origin. Adding the current origin back cancels the shift out —
  // without it, moving the panel left inflates the next reported position, which
  // grows it, which moves it further left, and the panel snaps to full screen
  // from a one-finger nudge.
  const resizeStart = useRef({ screenX: 0, screenY: 0, width: 0, height: 0 });

  const resize = useMemo(
    () =>
      PanResponder.create({
        // The grip is a target of its own with nothing tappable under it, so it
        // can claim the touch immediately: waiting for travel would let the list
        // behind it scroll first.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event: GestureResponderEvent) => {
          const current = getPanelFrame();
          resizeStart.current = {
            screenX: current.x + event.nativeEvent.pageX,
            screenY: current.y + event.nativeEvent.pageY,
            width: current.width,
            height: current.height,
          };
        },
        onPanResponderMove: (event: GestureResponderEvent) => {
          const start = resizeStart.current;
          const current = getPanelFrame();
          // Against the size at grab time, not the last frame, so nothing
          // accumulates across events.
          setPanelFrame({
            ...current,
            width:
              start.width +
              (current.x + event.nativeEvent.pageX - start.screenX),
            height:
              start.height +
              (current.y + event.nativeEvent.pageY - start.screenY),
          });
        },
        onPanResponderRelease: savePanelFrame,
        onPanResponderTerminate: savePanelFrame,
      }),
    []
  );

  return { dragHandlers: drag.panHandlers, resizeHandlers: resize.panHandlers };
}
