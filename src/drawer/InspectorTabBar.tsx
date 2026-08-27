/**
 * The drawer's horizontal tab strip — one button per registered inspector, each
 * reflecting its runtime status, in the user's order.
 *
 * Split from {@link InspectorTabs} (which owns selection and the tab *content*)
 * because the strip carries all the geometry: it measures every tab, scrolls a
 * clipped one into view, and hosts the hold-and-drag reorder. That machinery lives
 * in {@link useTabStrip}; this file is what it moves.
 *
 * Tabs are only draggable in the live drawer. A past session's strip drops the
 * browser-class tabs, and reordering an incomplete list against the full saved
 * order would mean guessing what the user meant.
 */

import { useMemo } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Inspector } from '../core/types';
import { useInspectorStatus } from '../core/status';
import { useBesouroUI, useViewingSession } from '../shared/context';
import { fontSize, fontWeight, radius } from '../theme/tokens';
import { withAlpha } from '../shared/utils/with-alpha';
import type { StringTable } from '../i18n';
import { useTabStrip } from './hooks/tab-strip';

/** How long a tab must be held before it lifts, in ms. */
const HOLD_DELAY = 300;

export function InspectorTabBar({
  inspectors,
  active,
  onSelect,
  reorderable,
}: {
  inspectors: Inspector[];
  active: Inspector | null;
  onSelect: (inspector: Inspector) => void;
  /** Whether a held tab can be dragged to a new position. */
  reorderable: boolean;
}): React.ReactNode {
  const s = useStyles();
  const strip = useTabStrip({ inspectors, active, reorderable });

  return (
    // The pan handlers sit on the wrapper, above the ScrollView: a drag has to be
    // captured from an ancestor to take the touch off the tab that was held.
    <View style={s.surface} {...strip.panHandlers}>
      <ScrollView
        ref={strip.scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        // Belt and braces: the capture already claims the touch, but on iOS the
        // scroll is a native gesture, so it is disabled outright while a tab is up.
        scrollEnabled={strip.dragging === null}
        contentContainerStyle={styles.content}
        onLayout={(e) => strip.measureViewport(e.nativeEvent.layout.width)}
        onContentSizeChange={(width) => strip.measureContent(width)}
        scrollEventThrottle={16}
        onScroll={(e) => strip.trackScroll(e.nativeEvent.contentOffset.x)}
      >
        {inspectors.map((inspector) => (
          <TabButton
            key={inspector}
            inspector={inspector}
            active={inspector === active}
            dragging={strip.dragging === inspector}
            lift={strip.lift}
            offset={strip.offsetFor(inspector)}
            onLayout={(x, width) => strip.measureTab(inspector, { x, width })}
            onLongPress={reorderable ? () => strip.hold(inspector) : undefined}
            onPressOut={() => {
              // A hold that never moved owes the selection its press didn't make.
              if (strip.release()) {
                onSelect(inspector);
                strip.revealTab(inspector);
              }
            }}
            onPress={() => {
              onSelect(inspector);
              strip.revealTab(inspector);
            }}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function TabButton({
  inspector,
  active,
  dragging,
  lift,
  offset,
  onPress,
  onLongPress,
  onPressOut,
  onLayout,
}: {
  inspector: Inspector;
  active: boolean;
  /** Held and being moved — rendered lifted, above its neighbours. */
  dragging: boolean;
  /** The strip's shared 0 → 1 lift; only meaningful while `dragging`. */
  lift: Animated.Value;
  /** Drag translate while held, displacement while another tab passes it. */
  offset: Animated.Value;
  onPress: () => void;
  onLongPress?: () => void;
  onPressOut: () => void;
  onLayout: (x: number, width: number) => void;
}): React.ReactNode {
  const { theme, strings, font } = useBesouroUI();
  const liveStatus = useInspectorStatus(inspector);
  // Status is about this process, so a past session's strip ignores it: an
  // inspector switched off since — or broken today — still has rows that session
  // recorded, and colouring the tab as failed would misattribute that to it.
  const status = useViewingSession() ? 'active' : liveStatus;
  // The active tab is marked by the accent color (text + bottom border); status
  // on inactive tabs is conveyed by the label color.
  const labelColor = active
    ? theme.accent
    : status === 'degraded'
      ? theme.danger
      : status === 'not-installed'
        ? theme.textMuted
        : theme.textMuted;

  return (
    // Measured here rather than on the Pressable: the strip needs each tab's x
    // within the scrolling content, and the Pressable's own x is relative to this.
    <Animated.View
      onLayout={(e) => {
        const { x, width } = e.nativeEvent.layout;
        onLayout(x, width);
      }}
      style={{
        transform: [
          { translateX: offset },
          // Animated rather than a `dragging ? …` constant: the tab is put back
          // down over the same motion that carries it to its new slot, so nothing
          // pops at the moment of the drop.
          {
            scale: dragging
              ? lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] })
              : 1,
          },
        ],
        // Raised above the tabs it passes over. zIndex only — deliberately not
        // Android's `elevation`, which looks like the obvious way to draw the
        // "picked up" shadow and is the one thing that made this glitch there.
        // It is a real Z shadow, shaped by the view's outline, and RN never
        // gives that outline the background's alpha: the shadow lands at full
        // strength on the first frame of the hold while the background below it
        // is still fading in, so the tab spends the lift as a dark empty
        // rectangle — clipped by the ScrollView at the viewport edges, and
        // re-rasterized every touch move because the tab is translating too.
        // The lift reads from the scale and the raised background instead,
        // which is all iOS has ever had here.
        zIndex: dragging ? 1 : 0,
        borderRadius: radius.md,
        backgroundColor: dragging
          ? lift.interpolate({
              inputRange: [0, 1],
              outputRange: [
                withAlpha(theme.surfaceRaised, 0),
                theme.surfaceRaised,
              ],
            })
          : 'transparent',
      }}
    >
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        onPressOut={onPressOut}
        delayLongPress={HOLD_DELAY}
        style={{
          paddingVertical: 11,
          paddingHorizontal: 14,
          borderBottomWidth: 2,
          borderBottomColor: active ? theme.accent : 'transparent',
        }}
      >
        <Text
          style={{
            color: labelColor,
            fontSize: font(fontSize.base),
            fontWeight: active ? fontWeight.bold : fontWeight.medium,
          }}
        >
          {labelFor(inspector, strings)}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export function labelFor(inspector: Inspector, strings: StringTable): string {
  switch (inspector) {
    case 'network':
      return strings.tabNetwork;
    case 'console':
      return strings.tabConsole;
    case 'websocket':
      return strings.tabWebSocket;
    case 'socketio':
      return strings.tabSocketIO;
    case 'notifications':
      return strings.tabNotifications;
    case 'asyncStorage':
      return strings.tabAsyncStorage;
    case 'mmkv':
      return strings.tabMMKV;
    case 'zustand':
      return strings.tabZustand;
    case 'redux':
      return strings.tabRedux;
    case 'jotai':
      return strings.tabJotai;
    case 'viewHierarchy':
      return strings.tabViewHierarchy;
    case 'fileSystem':
      return strings.tabFileSystem;
    case 'element':
      return strings.tabElement;
    default:
      return inspector;
  }
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 8,
  },
});

/** Theme-derived styles for this module, memoized per theme. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        surface: {
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
      }),
    [theme]
  );
}
