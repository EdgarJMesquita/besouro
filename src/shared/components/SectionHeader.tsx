/** Small uppercase heading that groups rows within a settings or detail screen. */

import { Text } from 'react-native';
import { useBesouroUI } from '../context';
import { space, fontSize, fontWeight } from '../../theme/tokens';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function SectionHeader({ title }: { title: string }): React.ReactNode {
  const s = useStyles();

  return <Text style={s.label}>{title}</Text>;
}

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.textMuted,
          fontSize: fontSize.caption,
          fontWeight: fontWeight.bold,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginTop: space.xl,
          marginBottom: space.xs,
        },
      }),
    [theme]
  );
}
