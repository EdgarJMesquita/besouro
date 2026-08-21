/**
 * A soft, tinted badge: a low-opacity wash of `color` behind `color` text, rather
 * than a bright solid fill. Reads clearly in both themes without being harsh.
 *
 * Colored badges (status / direction / accent) are borderless — just tint + text.
 * A neutral badge (`color === theme.textMuted`) instead gets a hairline gray
 * border so it stays legible against the drawer, matching the color system where
 * only outcomes carry a color.
 */

import { Text, View } from 'react-native';
import { useBesouroUI } from '../context';
import { space, radius, fontSize, fontWeight } from '../../theme/tokens';
import { withAlpha } from '../utils/with-alpha';

export function Pill({
  label,
  color,
  /** Solid fill instead of a tint — for the rare row that must outrank its peers. */
  filled = false,
}: {
  label: string;
  color: string;
  filled?: boolean;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const isNeutral = color === theme.textMuted;
  return (
    <View
      style={{
        paddingHorizontal: space.sm,
        paddingVertical: space.tight,
        borderRadius: radius.sm,
        backgroundColor: filled
          ? color
          : withAlpha(color, isNeutral ? 0.1 : 0.16),
        borderWidth: 1,
        borderColor: isNeutral && !filled ? theme.border : 'transparent',
      }}
    >
      <Text
        style={{
          color: filled ? theme.background : color,
          fontSize: fontSize.caption,
          fontWeight: fontWeight.bold,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
