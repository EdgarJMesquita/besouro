/** Bordered (or bare, with `plain`) text button in one of three tones. */

import { Pressable, Text, type ViewStyle } from 'react-native';
import { useBesouroUI } from '../context';
import { space, radius, fontSize, fontWeight } from '../../theme/tokens';

export function TextButton({
  label,
  onPress,
  tone = 'default',
  plain = false,
  style,
}: {
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger' | 'accent';
  /** When true, render as bare text — no border or background. */
  plain?: boolean;
  /** Extra container styles, e.g. to widen the button. Merged last. */
  style?: ViewStyle;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const color =
    tone === 'danger'
      ? theme.danger
      : tone === 'accent'
        ? theme.accent
        : theme.text;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      style={({ pressed }) =>
        plain
          ? {
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              opacity: pressed ? 0.6 : 1,
              alignItems: 'center',
              ...style,
            }
          : {
              paddingHorizontal: space.lg,
              paddingVertical: space.sm,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: theme.border,
              backgroundColor: pressed ? theme.surface : theme.surfaceRaised,
              alignItems: 'center',
              ...style,
            }
      }
    >
      <Text
        style={{
          color,
          fontSize: fontSize.base,
          fontWeight: fontWeight.semibold,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
