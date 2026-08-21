/**
 * One dispatched action in full: what was dispatched, and what it changed.
 *
 * Both sections are heavy columns, so they arrive from `useEventWithDetail` after
 * the summary the list already had — the header renders immediately and only the
 * two payloads wait. They sit behind `DetailTabs` rather than stacked, because a
 * serialized RTK Query response and a changed slice are each full-screen objects
 * and halving both would leave neither readable.
 */

import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { ReduxEvent } from '../../core/types';
import { useBesouroUI } from '../../shared/context';
import { useEventWithDetail } from '../../shared/hooks/event-detail';
import { BackButton } from '../../shared/components/BackButton';
import { DetailLoading } from '../../shared/components/DetailLoading';
import { DetailTabs } from '../../shared/components/DetailTabs';
import { DetailTimestamp } from '../../shared/components/DetailTimestamp';
import { EmptyState } from '../../shared/components/EmptyState';
import { JsonViewer } from '../../shared/components/JsonViewer';
import { MonoText } from '../../shared/components/MonoText';
import { Pill } from '../../shared/components/Pill';
import { BaselinePill } from '../../shared/components/BaselinePill';
import { space, fontSize, fontWeight } from '../../theme/tokens';
import { layout } from '../../shared/styles';

const DETAIL_TABS = ['payload', 'changed'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];

export function ActionDetail({
  summary,
}: {
  summary: ReduxEvent;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const { event, loadingDetail } = useEventWithDetail<ReduxEvent>(
    'redux',
    summary
  );
  const [tab, setTab] = useState<DetailTab>('payload');

  // The initial and closing rows carry the whole tree, so calling their section
  // "Changed slices" would be a lie — it is just State there.
  const labelFor = useCallback(
    (detailTab: DetailTab) =>
      detailTab === 'payload'
        ? strings.payload
        : event.stateIsFull
          ? strings.state
          : strings.changedSlices,
    [strings, event.stateIsFull]
  );

  return (
    <View style={layout.fill}>
      {/* The action type sits next to the back arrow, where `ZustandDetail` puts
          the store name: it is what you drilled in on, so it belongs in the
          toolbar rather than on a row of its own below it. */}
      <View style={s.row}>
        <BackButton />
        <MonoText
          style={layout.fill}
          size={fontSize.base}
          color={theme.text}
          selectable
        >
          {event.actionType}
        </MonoText>
        <DetailTimestamp timestamp={event.timestamp} />
      </View>

      {/* One wrapping row of badges, so a pill hugs its label instead of
          stretching the way it would as a column child. */}
      <View style={s.surface}>
        {event.isInitial || event.changedKeys.length > 0 ? (
          <View style={styles.keys}>
            <BaselinePill
              isInitial={event.isInitial}
              isReload={event.isReload}
            />
            {event.changedKeys.map((key) => (
              <Pill key={key} label={key} color={theme.accent} />
            ))}
          </View>
        ) : (
          <Text style={s.label}>{strings.noChanges}</Text>
        )}
      </View>

      <View style={s.tabs}>
        <DetailTabs
          tabs={DETAIL_TABS}
          selected={tab}
          onSelect={setTab}
          labelFor={labelFor}
        />
      </View>

      <DetailBody event={event} tab={tab} loading={loadingDetail} />
    </View>
  );
}

function DetailBody({
  event,
  tab,
  loading,
}: {
  event: ReduxEvent;
  tab: DetailTab;
  /** The heavy columns are still being read; don't claim "no payload" yet. */
  loading: boolean;
}): React.ReactNode {
  const { strings } = useBesouroUI();
  if (loading) {
    return <DetailLoading />;
  }
  if (tab === 'payload') {
    return event.payload ? (
      <JsonViewer raw={event.payload} truncated={event.payloadTruncated} />
    ) : (
      <EmptyState message={strings.noPayload} />
    );
  }
  return event.changedState ? (
    <JsonViewer
      raw={event.changedState}
      truncated={event.changedStateTruncated}
    />
  ) : (
    <EmptyState message={strings.noChanges} />
  );
}

const styles = StyleSheet.create({
  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
        surface: {
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.lg,
          backgroundColor: theme.surface,
        },
        tabs: {
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
        label: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          fontWeight: fontWeight.semibold,
        },
      }),
    [theme, font]
  );
}
