/**
 * Geometry and drag-to-reorder for the drawer's horizontal tab strip.
 *
 * Two jobs that share one set of measurements, which is why they live together:
 * scrolling a partially-clipped tab into view, and letting the user hold a tab and
 * drag it to a new position (persisted — see `core/tab-order.ts`). Both need every
 * tab's measured slot, the viewport width, and the live scroll offset.
 *
 * Built on `PanResponder` + `Animated` from React Native. The library ships with no
 * dependencies beyond its `react`/`react-native` peers, so a gesture library is not
 * an option — and `Animated` is what the rest of the drawer already animates with.
 *
 * The gesture is a *takeover*, not a gesture of its own: the tab's `Pressable`
 * recognises the long press, and the first finger movement after that hands the
 * touch to this responder mid-gesture (see `onMoveShouldSetPanResponderCapture`).
 * That way a tap still selects, a swipe still scrolls, and neither needs a
 * threshold tuned against the other.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  type GestureResponderHandlers,
} from 'react-native';
import type { Inspector } from '../../core/types';
import { moveInspector, setTabOrder } from '../../core/tab-order';
import { hapticTap } from '../../core/haptics';

/** Matches the strip's horizontal content padding, so a revealed tab keeps a gutter. */
const GUTTER = 8;
/** How close to a viewport edge a dragged tab must get before the strip scrolls. */
const EDGE_ZONE = 44;
/** Pixels per tick, and the tick, of that edge scroll. */
const EDGE_STEP = 6;
const EDGE_INTERVAL = 16;

interface Slot {
  x: number;
  width: number;
}

interface Drag {
  inspector: Inspector;
  /** Index the tab started at, and the index it would land on right now. */
  from: number;
  to: number;
  /** The tab's resting slot, and the scroll offset when the hold began. */
  slot: Slot;
  scrollAtGrant: number;
  /** Latest pan delta, replayed when an edge scroll moves the ground underneath. */
  dx: number;
  /** Set the moment the pan takes the touch over, before the press is terminated. */
  panning: boolean;
}

export interface TabStrip {
  /** Attach to the `ScrollView` — the hook scrolls it to reveal tabs. */
  scrollRef: React.RefObject<React.ComponentRef<typeof ScrollView> | null>;
  /** Attach to a view *wrapping* the `ScrollView`; it captures the drag. */
  panHandlers: GestureResponderHandlers;
  /** The tab being held, if any — the strip renders it lifted. */
  dragging: Inspector | null;
  /** How far that tab is lifted, 0 → 1. Drives its scale and shadow. */
  lift: Animated.Value;
  /** Horizontal offset to apply to a tab: its drag translate, or its displacement. */
  offsetFor: (inspector: Inspector) => Animated.Value;
  /** A tab's `onLongPress`. Ignored when the strip isn't reorderable. */
  hold: (inspector: Inspector) => void;
  /**
   * A tab's `onPressOut`. Ends a hold the pan never took over, returning `true`
   * when it did — that press produced no `onPress`, so it still owes a selection.
   */
  release: () => boolean;
  /** A tab's `onLayout`, and the strip's own viewport/content/scroll reporters. */
  measureTab: (inspector: Inspector, slot: Slot) => void;
  measureViewport: (width: number) => void;
  measureContent: (width: number) => void;
  trackScroll: (offset: number) => void;
  /** Scroll a clipped tab fully into view (no-op when it already is). */
  revealTab: (inspector: Inspector, animated?: boolean) => void;
}

/** Whether two strips list the same inspectors in the same places. */
function sameOrder(a: readonly Inspector[], b: readonly Inspector[]): boolean {
  return a.length === b.length && a.every((entry, i) => entry === b[i]);
}

export function useTabStrip({
  inspectors,
  active,
  reorderable,
}: {
  inspectors: Inspector[];
  active: Inspector | null;
  reorderable: boolean;
}): TabStrip {
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView> | null>(null);
  const viewportWidth = useRef(0);
  const contentWidth = useRef(0);
  const scrollOffset = useRef(0);
  const slots = useRef<Partial<Record<Inspector, Slot>>>({});
  // Guards the one-time scroll to the active tab on mount so it doesn't fight
  // later layout passes.
  const didInitialScroll = useRef(false);

  // Read through refs so the responder below can be built once and still see the
  // current order and the current reorderable-ness.
  const inspectorsRef = useRef(inspectors);
  inspectorsRef.current = inspectors;
  const reorderableRef = useRef(reorderable);
  reorderableRef.current = reorderable;
  const activeRef = useRef(active);
  activeRef.current = active;

  const [dragging, setDragging] = useState<Inspector | null>(null);
  const drag = useRef<Drag | null>(null);
  const offsets = useRef<Partial<Record<Inspector, Animated.Value>>>({});
  // 0 → 1 while a tab is held: how far it is out of the strip (scale, shadow).
  const lift = useRef(new Animated.Value(0)).current;
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const edgeDirection = useRef(0);
  /** The order a finished drop committed, until the strip renders in it. */
  const pendingOrder = useRef<Inspector[] | null>(null);
  /** A dropped tab is still travelling to its slot. */
  const landing = useRef(false);

  // Drop the drag offsets the frame the reordered strip lays out — not before, and
  // only once it is *that* order on screen. The committed order puts every tab
  // exactly where its offset was already holding it, so the two cancel and nothing
  // moves. Clearing them any earlier clears them against the old layout, and the
  // strip flashes its pre-drag arrangement before the new one arrives — a tab
  // snapping back, then jumping.
  useLayoutEffect(() => {
    const expected = pendingOrder.current;
    if (!expected || !sameOrder(expected, inspectors)) {
      return;
    }
    pendingOrder.current = null;
    for (const value of Object.values(offsets.current)) {
      // A displacement spring may still be in flight; without this it would write
      // the old offset back on its next frame.
      value.stopAnimation();
      value.setValue(0);
    }
  }, [inspectors, dragging]);

  // The drawer can go away mid-drag — closing it tears the whole native surface
  // down — and the edge scroll is the one thing here that outlives the component
  // on its own.
  useEffect(
    () => () => {
      if (edgeTimer.current) {
        clearInterval(edgeTimer.current);
      }
    },
    []
  );

  const strip = useMemo<TabStrip>(() => {
    const offsetFor = (inspector: Inspector): Animated.Value => {
      const existing = offsets.current[inspector];
      if (existing) {
        return existing;
      }
      const created = new Animated.Value(0);
      offsets.current[inspector] = created;
      return created;
    };

    const revealTab = (inspector: Inspector, animated = true): void => {
      const slot = slots.current[inspector];
      const viewport = viewportWidth.current;
      if (!slot || viewport === 0) {
        return;
      }
      const left = slot.x - GUTTER;
      const right = slot.x + slot.width + GUTTER;
      let target: number | null = null;
      if (right > scrollOffset.current + viewport) {
        target = right - viewport;
      } else if (left < scrollOffset.current) {
        target = left;
      }
      if (target !== null) {
        scrollRef.current?.scrollTo({ x: Math.max(0, target), animated });
      }
    };

    // On mount the strip starts scrolled fully left, but the remembered active tab
    // may sit off-screen to the right (the native bubble flow rebuilds this surface
    // on every open). Once the viewport width and that tab's slot are both
    // measured, jump — un-animated — to reveal it. Runs once.
    const revealActiveOnMount = (): void => {
      const target = activeRef.current;
      if (didInitialScroll.current || !target) {
        return;
      }
      if (!slots.current[target] || viewportWidth.current === 0) {
        return;
      }
      didInitialScroll.current = true;
      revealTab(target, false);
    };

    /** Where the dragged tab would land, given its centre in content space. */
    const targetIndexFor = (centre: number, from: number): number => {
      let target = from;
      inspectorsRef.current.forEach((inspector, index) => {
        const slot = slots.current[inspector];
        if (!slot || index === from) {
          return;
        }
        const midpoint = slot.x + slot.width / 2;
        if (index < from && centre < midpoint) {
          target = Math.min(target, index);
        } else if (index > from && centre > midpoint) {
          target = Math.max(target, index);
        }
      });
      return target;
    };

    /**
     * Slide the tabs the dragged one has passed out of its way. Lifting a tab out
     * of the flow moves everything after it left by exactly that tab's width, so
     * that is the displacement regardless of how wide the neighbours are.
     */
    const applyDisplacement = (d: Drag): void => {
      inspectorsRef.current.forEach((inspector, index) => {
        if (inspector === d.inspector) {
          return;
        }
        let shift = 0;
        if (d.to > d.from && index > d.from && index <= d.to) {
          shift = -d.slot.width;
        } else if (d.to < d.from && index >= d.to && index < d.from) {
          shift = d.slot.width;
        }
        Animated.spring(offsetFor(inspector), {
          toValue: shift,
          useNativeDriver: false,
          friction: 9,
          tension: 90,
        }).start();
      });
    };

    const stopEdgeScroll = (): void => {
      if (edgeTimer.current) {
        clearInterval(edgeTimer.current);
        edgeTimer.current = null;
      }
      edgeDirection.current = 0;
    };

    /**
     * Follow the finger past the viewport edge. With nine tabs most of the strip is
     * off-screen, so without this a tab could only be dropped where it already
     * fits.
     */
    const updateEdgeScroll = (centre: number): void => {
      const onScreen = centre - scrollOffset.current;
      const viewport = viewportWidth.current;
      const direction =
        onScreen < EDGE_ZONE ? -1 : onScreen > viewport - EDGE_ZONE ? 1 : 0;
      if (direction === edgeDirection.current) {
        return;
      }
      stopEdgeScroll();
      if (direction === 0) {
        return;
      }
      edgeDirection.current = direction;
      edgeTimer.current = setInterval(() => {
        const d = drag.current;
        if (!d) {
          stopEdgeScroll();
          return;
        }
        const max = Math.max(0, contentWidth.current - viewportWidth.current);
        const next = Math.min(
          max,
          Math.max(0, scrollOffset.current + direction * EDGE_STEP)
        );
        if (next === scrollOffset.current) {
          stopEdgeScroll();
          return;
        }
        // Optimistic: `onScroll` confirms it a frame later, and the replay below
        // needs the new offset now.
        scrollOffset.current = next;
        scrollRef.current?.scrollTo({ x: next, animated: false });
        track(d, d.dx);
      }, EDGE_INTERVAL);
    };

    /** Re-place the held tab and everything it displaces, for a pan delta. */
    const track = (d: Drag, dx: number): void => {
      d.dx = dx;
      // The tab lives inside the scrolling content, so an edge scroll would carry
      // it away from the finger. Adding the scroll delta keeps it under the touch.
      const scrolled = scrollOffset.current - d.scrollAtGrant;
      offsetFor(d.inspector).setValue(dx + scrolled);

      const centre = d.slot.x + dx + scrolled + d.slot.width / 2;
      const target = targetIndexFor(centre, d.from);
      if (target !== d.to) {
        d.to = target;
        applyDisplacement(d);
      }
      updateEdgeScroll(centre);
    };

    /** Content-space distance from the tab's slot to where it will come to rest. */
    const landingOffset = (d: Drag): number => {
      const order = inspectorsRef.current;
      let distance = 0;
      if (d.to > d.from) {
        for (let i = d.from + 1; i <= d.to; i++) {
          distance += slots.current[order[i]!]?.width ?? 0;
        }
      } else {
        for (let i = d.to; i < d.from; i++) {
          distance -= slots.current[order[i]!]?.width ?? 0;
        }
      }
      return distance;
    };

    const finish = (commit: boolean): void => {
      const d = drag.current;
      if (!d) {
        return;
      }
      stopEdgeScroll();
      drag.current = null;
      landing.current = true;

      const order = inspectorsRef.current;
      const moved = commit && d.to !== d.from;

      // Land the tab in the gap its neighbours already opened — and put it back
      // down (`lift`) on the way, so the drop is one motion rather than a snap
      // followed by a shrink.
      const animations = [
        Animated.spring(lift, {
          toValue: 0,
          useNativeDriver: false,
          friction: 8,
          tension: 120,
        }),
        Animated.spring(offsetFor(d.inspector), {
          toValue: moved ? landingOffset(d) : 0,
          useNativeDriver: false,
          friction: 9,
          tension: 120,
        }),
      ];
      if (!moved) {
        // Nothing to commit — everything goes back where it started.
        for (const inspector of order) {
          if (inspector !== d.inspector) {
            animations.push(
              Animated.spring(offsetFor(inspector), {
                toValue: 0,
                useNativeDriver: false,
                friction: 9,
                tension: 90,
              })
            );
          }
        }
      }

      Animated.parallel(animations).start(() => {
        landing.current = false;
        // Every tab is now sitting exactly where the new order will put it, so
        // committing changes nothing on screen. The offsets that hold it there are
        // cleared a beat later, once that order has actually laid out (see the
        // effect above) — clearing them here instead paints one frame of the old
        // arrangement before the new one arrives, which reads as a tab snapping
        // back and then jumping.
        if (moved) {
          const next = moveInspector(order, d.from, d.to);
          pendingOrder.current = next;
          setTabOrder(next);
        }
        setDragging(null);
      });
    };

    const responder = PanResponder.create({
      // Never claims a fresh touch: taps and scrolls must reach the tabs and the
      // ScrollView untouched. The only way in is a hold that is already in
      // progress, at which point this capture takes the touch off the Pressable.
      onMoveShouldSetPanResponderCapture: () => {
        const d = drag.current;
        if (!d) {
          return false;
        }
        // Claimed before the press terminates, which is how `release` below knows
        // the lift it is about to see is the takeover rather than the user letting
        // go.
        d.panning = true;
        return true;
      },
      onPanResponderMove: (_event, gesture) => {
        const d = drag.current;
        if (d) {
          track(d, gesture.dx);
        }
      },
      // The strip owns the touch until the finger lifts: handing it back mid-drag
      // would leave a tab stranded between slots.
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => finish(true),
      onPanResponderTerminate: () => finish(false),
    });

    return {
      scrollRef,
      panHandlers: responder.panHandlers,
      dragging: null,
      lift,
      offsetFor,
      hold: (inspector) => {
        // A landing or pending order means the previous drop is still settling.
        // Taking a new hold now would measure slots that are about to move — and
        // starting a second `lift` animation would cut the landing short, firing
        // its completion callback early against indices that no longer hold.
        if (
          !reorderableRef.current ||
          drag.current ||
          landing.current ||
          pendingOrder.current
        ) {
          return;
        }
        const slot = slots.current[inspector];
        const from = inspectorsRef.current.indexOf(inspector);
        if (!slot || from < 0) {
          return;
        }
        drag.current = {
          inspector,
          from,
          to: from,
          slot,
          scrollAtGrant: scrollOffset.current,
          dx: 0,
          panning: false,
        };
        setDragging(inspector);
        // Fired here, with the lift: the tab is now carrying the finger, and
        // nothing else on screen has said so yet — the scale and shadow are a
        // spring away, and the strip may be under the hand that started it.
        hapticTap();
        Animated.spring(lift, {
          toValue: 1,
          useNativeDriver: false,
          friction: 7,
          tension: 140,
        }).start();
      },
      release: () => {
        // A hold the pan never took over — the user pressed, waited, and lifted
        // without moving. Put the tab back down, and report it so the caller can
        // select it: `Pressability` suppresses `onPress` once a long press has
        // fired, so without this a slow tap would lift a tab and change nothing.
        if (drag.current && !drag.current.panning) {
          finish(false);
          return true;
        }
        return false;
      },
      measureTab: (inspector, slot) => {
        slots.current[inspector] = slot;
        revealActiveOnMount();
      },
      measureViewport: (width) => {
        viewportWidth.current = width;
        revealActiveOnMount();
      },
      measureContent: (width) => {
        contentWidth.current = width;
      },
      trackScroll: (offset) => {
        // Throttled scroll events lag the edge scroll, which writes the offset it
        // just asked for. Taking a late event's older offset would step the next
        // tick backwards from it and shake the held tab against the finger, so
        // while the strip is driving itself its own value is the truth.
        if (edgeDirection.current !== 0) {
          return;
        }
        scrollOffset.current = offset;
      },
      revealTab,
    };
    // Built once — `lift` is a ref value, so the dependency never changes. Every
    // handler reads live state through a ref, so nothing here goes stale as the
    // order, the active tab, or the measurements change. Nothing *depends* on the
    // memo holding, either: a rebuild would produce an equivalent responder over
    // the same refs.
  }, [lift]);

  return { ...strip, dragging };
}
