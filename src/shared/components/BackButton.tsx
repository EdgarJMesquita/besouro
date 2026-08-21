/**
 * Icon-only back button — a left chevron composed from Views (no text). When no
 * `onPress` is given it falls back to the enclosing DetailOverlay's animated
 * close, so details slide out on back the same way they slid in.
 */

import { Pressable } from 'react-native';
import { useBesouroUI } from '../context';
import { useDetailBack } from './DetailOverlay';
import { Icon } from './Icon';
import { StyleSheet } from 'react-native';

export function BackButton({
  onPress,
}: {
  onPress?: () => void;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  const detailBack = useDetailBack();
  const handlePress = onPress ?? detailBack ?? undefined;
  return (
    <Pressable
      onPress={handlePress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={strings.close}
      style={styles.box}
    >
      <Icon name="arrow-left" size={18} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 34,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
