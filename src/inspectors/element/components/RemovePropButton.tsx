/**
 * Removes a prop from the inspected element.
 *
 * Every prop gets one, not just ones added here — dropping a prop the app set is
 * as useful an experiment as changing it ("what does this look like without
 * `numberOfLines`?"), and it is exactly as ephemeral: the app's next render
 * restores whatever it passes.
 *
 * There is no undo, so the affordance is withheld where a removal couldn't be
 * walked back: `children` holds a React element, which the Add row — strings,
 * numbers and booleans — cannot reproduce. Everything else can be typed back in,
 * and re-picking the element resets every edit anyway.
 */

import { Pressable } from 'react-native';

import { useBesouroUI } from '../../../shared/context';
import { Icon } from '../../../shared/components/Icon';

export function RemovePropButton({
  name,
  onPress,
}: {
  name: string;
  onPress: () => void;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`${strings.remove} ${name}`}
    >
      <Icon name="close" size={14} color={theme.textMuted} />
    </Pressable>
  );
}
