/**
 * One request in the list: method · URL · duration · status.
 *
 * Memoized, and takes `onSelect(id)` rather than a pre-bound closure, so a row
 * only re-renders when its own event (or the list-level URL mode) changes.
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { NetworkEvent } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import { Pill } from '../../../shared/components/Pill';
import { space } from '../../../theme/tokens';
import { formatDuration } from '../../../shared/utils/duration-format';
import { formatUrl, type UrlMode } from '../format';
import { StatusPill } from './StatusPill';
import { useTextStyles } from '../../../shared/hooks/text-styles';

export const NetworkRow = memo(function NetworkRow({
  event,
  urlMode,
  onSelect,
}: {
  event: NetworkEvent;
  urlMode: UrlMode;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const text = useTextStyles();
  const handlePress = useCallback(
    () => onSelect(event.id),
    [onSelect, event.id]
  );
  return (
    <Pressable onPress={handlePress} style={styles.container}>
      <Pill label={event.method} color={theme.accent} />
      <Text numberOfLines={1} ellipsizeMode="tail" style={text.monoFill}>
        {formatUrl(event.url, urlMode)}
      </Text>
      <Text style={text.caption}>
        {event.phase === 'pending' ? '' : formatDuration(event.durationMs)}
      </Text>
      <StatusPill event={event} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
});
