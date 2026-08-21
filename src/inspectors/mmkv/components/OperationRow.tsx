/**
 * One captured MMKV operation: operation badge · time, then the key it touched.
 *
 * Memoized, and takes `onSelect(id)` rather than a pre-bound closure, so a row only
 * re-renders when its own event changes. No duration column, unlike the AsyncStorage
 * row — MMKV is synchronous, so every value would be zero.
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MMKVEvent } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import { MonoText } from '../../../shared/components/MonoText';
import { space, fontSize } from '../../../theme/tokens';
import { formatTime } from '../../../shared/utils/date-format';
import { OperationPill } from './OperationPill';
import { layout } from '../../../shared/styles';
import { useTextStyles } from '../../../shared/hooks/text-styles';

export const OperationRow = memo(function OperationRow({
  event,
  onSelect,
}: {
  event: MMKVEvent;
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
        {event.valueType ? (
          <Text style={text.caption}>{event.valueType}</Text>
        ) : null}
        <Text style={text.caption}>{formatTime(event.timestamp)}</Text>
      </View>
      <MonoText
        color={event.error ? theme.danger : theme.text}
        size={fontSize.body}
      >
        {event.key ?? '—'}
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
