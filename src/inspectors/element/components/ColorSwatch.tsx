/** A rounded square filled with a color value, shown beside color-valued rows. */

import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBesouroUI } from '../../../shared/context';

import { radius } from '../../../theme/tokens';

/**
 * The swatch for one color value. `color` may be null: the outline still renders
 * so an editor mid-edit (`#ff` on the way to `#ff0000`) keeps its place in the
 * row instead of making everything shuffle sideways on each keystroke.
 *
 * The border does double duty — it keeps a white swatch visible on a light
 * surface, and it's the whole of what a `transparent` value looks like.
 */
export function ColorSwatch({
  color,
}: {
  color: string | null;
}): React.ReactNode {
  const s = useStyles();

  return (
    <View
      accessible
      accessibilityLabel={color ?? undefined}
      style={[s.swatch, { backgroundColor: color ?? 'transparent' }]}
    />
  );
}

/** Theme-derived styles for this module, memoized per theme. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        swatch: {
          width: 16,
          height: 16,
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor: theme.border,
        },
      }),
    [theme]
  );
}
