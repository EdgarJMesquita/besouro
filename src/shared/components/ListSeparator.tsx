/**
 * A hairline row divider for list rows — used as a `FlatList`
 * `ItemSeparatorComponent` so every list reads as evenly separated entries
 * (no trailing line after the last row).
 */

import { View } from 'react-native';
import { useBesouroUI } from '../context';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function ListSeparator(): React.ReactNode {
  const s = useStyles();

  return <View style={s.surface} />;
}

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        surface: {
          height: 1,
          backgroundColor: theme.border,
        },
      }),
    [theme]
  );
}
