/** A prop name, styled to distinguish style props from ordinary ones. */

import { Text } from 'react-native';

import { useBesouroUI } from '../../../shared/context';

import { fontSize, fontWeight } from '../../../theme/tokens';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function PropName({ name }: { name: string }): React.ReactNode {
  const s = useStyles();

  return (
    <Text style={s.label} selectable>
      {name}
    </Text>
  );
}

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.textFaint,
          fontSize: fontSize.caption,
          fontWeight: fontWeight.medium,
          flex: 0.4,
        },
      }),
    [theme]
  );
}
