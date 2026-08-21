/**
 * One storage operation in the list: operation badge · duration · time, then the
 * keys it touched.
 *
 * Memoized, and takes `onSelect(id)` rather than a pre-bound closure, so a row
 * only re-renders when its own event changes.
 */

import { memo, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { AsyncStorageEvent } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import { MonoText } from '../../../shared/components/MonoText';
import { space, fontSize } from '../../../theme/tokens';
import { formatTime } from '../../../shared/utils/date-format';
import { formatDuration } from '../../../shared/utils/duration-format';
import { OperationPill } from './OperationPill';
import { layout } from '../../../shared/styles';
import { useTextStyles } from '../../../shared/hooks/text-styles';
import { StyleSheet } from 'react-native';

export const AsyncStorageRow = memo(function AsyncStorageRow({
  event,
  onSelect,
}: {
  event: AsyncStorageEvent;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const text = useTextStyles();
  const { theme } = useBesouroUI();
  const handlePress = useCallback(
    () => onSelect(event.id),
    [onSelect, event.id]
  );
  return (
    <Pressable onPress={handlePress} style={styles.container}>
      <View style={layout.rowGapSm}>
        <OperationPill
          operation={event.operation}
          direction={event.direction}
        />
        <View style={layout.fill} />
        <Text style={text.caption}>{formatDuration(event.durationMs)}</Text>
        <Text style={text.caption}>{formatTime(event.timestamp)}</Text>
      </View>
      <MonoText color={theme.text} size={fontSize.body}>
        {event.keys.join(', ') || '—'}
      </MonoText>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
});
