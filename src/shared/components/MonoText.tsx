/** Monospace text in the active theme — the default for values, paths, and payloads. */

import { Text, type TextStyle } from 'react-native';
import { useBesouroUI } from '../context';
import { fontSize } from '../../theme/tokens';

const MONO_FONT = 'Courier';

export function MonoText({
  children,
  color,
  size = fontSize.body,
  style,
  selectable,
  numberOfLines,
}: {
  children: string;
  color?: string;
  size?: number;
  style?: TextStyle;
  selectable?: boolean;
  /** Clamp to this many lines, ellipsizing at the tail — for list rows. */
  numberOfLines?: number;
}): React.ReactNode {
  const { theme, font } = useBesouroUI();
  return (
    <Text
      selectable={selectable}
      numberOfLines={numberOfLines}
      ellipsizeMode="tail"
      style={[
        {
          fontFamily: MONO_FONT,
          fontSize: font(size),
          color: color ?? theme.text,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
