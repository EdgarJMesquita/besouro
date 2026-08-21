/**
 * One socket client in the list: connection status, label, and event count.
 *
 * Memoized on plain scalars and takes `onSelect(id)` rather than a pre-bound
 * closure, so a row only re-renders when its own client changes.
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBesouroUI } from '../context';
import { MonoText } from './MonoText';
import { StatusDot } from './StatusDot';
import { space, fontSize } from '../../theme/tokens';
import { formatTime } from '../utils/date-format';
import type { ConnectionStatus } from './SocketTabBase';
import { useTextStyles } from '../hooks/text-styles';

export const SocketClientRow = memo(function SocketClientRow({
  id,
  label,
  count,
  last,
  status,
  onSelect,
}: {
  id: string;
  label: string;
  count: number;
  last: number;
  status: ConnectionStatus;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  const text = useTextStyles();
  const handlePress = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <Pressable onPress={handlePress} style={styles.container}>
      <StatusDot status={status} />
      <View style={styles.body}>
        <MonoText color={theme.text} size={fontSize.base}>
          {label}
        </MonoText>
        <Text style={text.caption}>
          {`${count} ${count === 1 ? strings.event : strings.events} · ${formatTime(last)}`}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
  body: { flex: 1, gap: space.xs },
});
