/**
 * The tab's one button.
 *
 * The capture happens on mount, so this is for after the app has moved on — you
 * navigate, come back to the drawer, and want the tree as it is now.
 */

import { StyleSheet, View } from 'react-native';
import { useBesouroUI } from '../../../shared/context';
import { TextButton } from '../../../shared/components/TextButton';
import { layout } from '../../../shared/styles';
import { space } from '../../../theme/tokens';

/** Re-reads the tree. The capture happens on mount; this is for after the app moves. */
export function Toolbar({
  onRefresh,
}: {
  onRefresh: () => void;
}): React.ReactNode {
  const { strings } = useBesouroUI();
  return (
    <View style={styles.toolbar}>
      <TextButton
        label={strings.refresh}
        tone="accent"
        onPress={onRefresh}
        style={layout.fill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingVertical: space.md,
  },
});
