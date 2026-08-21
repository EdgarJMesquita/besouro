/** Centered placeholder shown when a list has nothing to display. */

import { Text, View } from 'react-native';
import { useBesouroUI } from '../context';
import { fontSize } from '../../theme/tokens';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function EmptyState({ message }: { message: string }): React.ReactNode {
  const s = useStyles();

  return (
    <View style={styles.container}>
      <Text style={s.label}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.textMuted,
          fontSize: fontSize.base,
          textAlign: 'center',
        },
      }),
    [theme]
  );
}
