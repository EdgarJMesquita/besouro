/** Boxed label + monospace value with a copy affordance in the header. */

import { Text, View } from 'react-native';
import { useBesouroUI } from '../context';
import { space, radius, fontSize, fontWeight } from '../../theme/tokens';
import { CopyButton } from './CopyButton';
import { MonoText } from './MonoText';
import { layout } from '../styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function CardWithCopy({
  label,
  value,
  copyable = true,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}): React.ReactNode {
  const s = useStyles();

  return (
    <View style={s.surface}>
      <View style={styles.row}>
        <Text style={s.label}>{label}</Text>
        {copyable ? <CopyButton value={value} /> : null}
      </View>
      <View style={layout.rowGapSm}>
        <MonoText style={layout.fill} size={fontSize.body}>
          {value}
        </MonoText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
          color: theme.textMuted,
          fontSize: fontSize.micro,
          fontWeight: fontWeight.bold,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        surface: {
          backgroundColor: theme.surfaceRaised,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: radius.lg,
          padding: space.lg,
          gap: space.xs,
        },
      }),
    [theme]
  );
}
