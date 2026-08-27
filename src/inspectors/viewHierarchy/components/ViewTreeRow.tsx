/**
 * One row of the captured view tree: indented by depth, named by class.
 *
 * The indentation is drawn as rails rather than as whitespace — see below for
 * why — which is the only thing here that is more than a line of text.
 */

import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBesouroUI } from '../../../shared/context';
import { fontSize, space } from '../../../theme/tokens';
import type { HierarchyNode } from '../types';

/** dp of indent per tree level. */
const INDENT = 10;

/** One tree row: indented by depth, named by class, tagged where React owns it. */
/**
 * Memoized, and the props are shaped so the memo can actually bite.
 *
 * A capture is hundreds of rows, and the tab re-renders on every frame of a
 * slider drag. Without this the list re-rendered every mounted row each time,
 * which is what React Native's "large list is slow to update" warning was
 * reporting. `onPress` takes the index rather than closing over it, so the
 * handler stays the same function across renders and the comparison holds.
 */
export const ViewTreeRow = memo(function TreeRow({
  node,
  depth,
  index,
  selected,
  onPress,
}: {
  node: HierarchyNode;
  /**
   * Levels to indent, relative to whatever the list is rooted at — not
   * `node.depth`, which is absolute. See `baseDepth`.
   */
  depth: number;
  /** This row's index into `ViewTreeSnapshot.nodes`, handed back on press. */
  index: number;
  selected: boolean;
  onPress: (index: number) => void;
}): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  return (
    <Pressable
      onPress={() => onPress(index)}
      style={{
        flexDirection: 'row',
        // No vertical padding here — it belongs to the label below, so the rails
        // stretch the full height of the row. On the Pressable it stops them at
        // the text's box, and consecutive rows come out as stacked dashes rather
        // than the continuous rules an editor draws.
        paddingRight: space.gutter,
        paddingLeft: space.gutter,
        backgroundColor: selected ? theme.surfaceRaised : 'transparent',
      }}
    >
      {/* One rail per ancestor, in place of plain indentation.
          
          Whitespace alone puts the burden on the eye: two rows indented the same
          amount are siblings, but on a list this long you have to scan up to find
          the parent they share, and a row's own indent tells you nothing about
          which of the rows above it belongs to. The rails draw that line
          literally — a row's parent is whatever the last rail descends from. */}
      {Array.from({ length: Math.max(0, depth) }, (_, level) => (
        <View
          key={level}
          style={{
            width: INDENT,
            borderLeftWidth: StyleSheet.hairlineWidth,
            borderLeftColor: theme.border,
          }}
        />
      ))}
      <Text numberOfLines={1} style={s.rowText}>
        {node.className}
        {node.testID ? <Text style={s.rowMeta}> {node.testID}</Text> : null}
      </Text>
    </Pressable>
  );
});

/** Theme-derived styles for a row, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        rowText: {
          color: theme.text,
          fontSize: font(fontSize.body),
          // The row's height, so the guide rails beside it run edge to edge.
          paddingVertical: space.xs,
          flexShrink: 1,
        },
        rowMeta: {
          color: theme.textFaint,
          fontSize: font(fontSize.caption),
        },
      }),
    [theme, font]
  );
}
