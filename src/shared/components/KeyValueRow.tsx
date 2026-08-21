/** Label/value pair on one hairline-separated row — the detail-screen workhorse. */

import { Text, View } from 'react-native';
import { useBesouroUI } from '../context';
import { space, fontSize, fontWeight } from '../../theme/tokens';
import { MonoText } from './MonoText';
import { layout } from '../styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function KeyValueRow({
  label,
  value,
  copyable = true,
  paddingHorizontal = 0,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  /** Optional inner horizontal padding; defaults to 0 (flush to its container). */
  paddingHorizontal?: number;
}): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: space.lg,
        paddingHorizontal,
        gap: space.md,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <Text style={s.label} selectable>
        {label}
      </Text>
      <View style={styles.row}>
        <MonoText style={layout.fill} selectable={copyable}>
          {value}
        </MonoText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 0.6,
    flexDirection: 'row',
    gap: space.sm,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.textFaint,
          fontSize: fontSize.body,
          fontWeight: fontWeight.medium,
          flex: 0.4,
        },
      }),
    [theme]
  );
}
