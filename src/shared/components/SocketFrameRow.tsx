/**
 * One frame in a socket client's timeline.
 *
 * Takes the adapter-resolved values as plain scalars rather than the event plus
 * adapter, so memo compares cheaply and the row stays free of the generic.
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { SocketDirection } from '../../core/types';
import { MonoText } from './MonoText';
import { DirectionPill } from './DirectionPill';
import { space, fontSize } from '../../theme/tokens';
import { formatTime } from '../utils/date-format';
import { layout } from '../styles';
import { useTextStyles } from '../hooks/text-styles';

export const SocketFrameRow = memo(function SocketFrameRow({
  id,
  direction,
  isError,
  title,
  timestamp,
  onSelect,
}: {
  id: string;
  direction: SocketDirection;
  isError: boolean;
  title: string;
  timestamp: number;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const text = useTextStyles();
  const handlePress = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <Pressable onPress={handlePress} style={styles.container}>
      <DirectionPill direction={direction} isError={isError} />
      <MonoText style={layout.fill} size={fontSize.body}>
        {title}
      </MonoText>
      <Text style={text.caption}>{formatTime(timestamp)}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
});
