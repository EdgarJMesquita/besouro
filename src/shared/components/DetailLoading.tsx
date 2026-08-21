/**
 * Placeholder for a detail section whose heavy columns are still being read.
 *
 * List rows carry no bodies, headers or payloads, so opening a detail view issues
 * a fetch. It is a primary-key lookup and usually resolves within a frame or two —
 * this exists so the gap reads as "loading" rather than as "no body", which is
 * what an empty state would wrongly claim.
 */

import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useBesouroUI } from '../context';
import { space } from '../../theme/tokens';
import { layout } from '../styles';

export function DetailLoading(): React.ReactNode {
  const { theme } = useBesouroUI();
  return (
    <View style={[layout.fill, styles.container]}>
      <ActivityIndicator color={theme.textFaint} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
});
