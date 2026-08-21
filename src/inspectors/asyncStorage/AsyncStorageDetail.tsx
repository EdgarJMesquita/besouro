/**
 * AsyncStorage detail screen — the full record for one storage operation.
 */

import { Text, View } from 'react-native';

import type { AsyncStorageEvent } from '../../core/types';
import { useBesouroUI } from '../../shared/context';

import { BackButton } from '../../shared/components/BackButton';
import { EmptyState } from '../../shared/components/EmptyState';

import { MonoText } from '../../shared/components/MonoText';

import { space, fontSize } from '../../theme/tokens';

import { JsonViewer } from '../../shared/components/JsonViewer';
import { DetailTimestamp } from '../../shared/components/DetailTimestamp';

import { formatDuration } from '../../shared/utils/duration-format';
import { OperationPill } from './components/OperationPill';
import { layout } from '../../shared/styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';
import { useEventWithDetail } from '../../shared/hooks/event-detail';
import { DetailLoading } from '../../shared/components/DetailLoading';

/**
 * `summary` is the list row: operation, keys and duration, but not the stored
 * value — that is a heavy column fetched only when this view opens.
 */
export function AsyncStorageDetail({
  summary,
}: {
  summary: AsyncStorageEvent;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const { event, loadingDetail } = useEventWithDetail<AsyncStorageEvent>(
    'asyncStorage',
    summary
  );
  return (
    <View style={layout.fill}>
      <View style={s.row}>
        <BackButton />
        <OperationPill
          operation={event.operation}
          direction={event.direction}
        />
        <MonoText style={layout.fill} size={fontSize.body}>
          {formatDuration(event.durationMs)}
        </MonoText>
        <DetailTimestamp timestamp={event.timestamp} />
      </View>
      <View style={styles.container3}>
        <Text style={s.label2}>{strings.key}</Text>
        <MonoText color={theme.text} selectable>
          {event.keys.join(', ') || '—'}
        </MonoText>
      </View>
      {event.error ? (
        <View style={styles.container2}>
          <MonoText color={theme.danger} selectable>
            {event.error}
          </MonoText>
        </View>
      ) : loadingDetail ? (
        // The value is still being read; "no value" would be a lie for a frame.
        <DetailLoading />
      ) : event.value ? (
        <JsonViewer
          raw={event.value}
          truncated={event.valueTruncated}
          ListHeaderComponent={
            <View style={styles.container}>
              <Text style={s.label}>{strings.value}</Text>
            </View>
          }
        />
      ) : (
        <EmptyState message={strings.noValue} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  container2: {
    padding: space.lg,
  },
  container3: {
    padding: space.lg,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          marginBottom: 2,
        },
        label2: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          marginBottom: 2,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
      }),
    [theme, font]
  );
}
