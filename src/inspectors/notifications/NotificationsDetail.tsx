/**
 * Notification detail screen — the delivered payload, either field-by-field or as
 * the raw provider record.
 */

import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import type { NotificationEvent } from '../../core/types';
import { useBesouroUI } from '../../shared/context';
import { DetailTabs } from '../../shared/components/DetailTabs';

import { BackButton } from '../../shared/components/BackButton';
import { EmptyState } from '../../shared/components/EmptyState';
import { KeyValueRow } from '../../shared/components/KeyValueRow';

import { Pill } from '../../shared/components/Pill';
import { space, fontSize, fontWeight } from '../../theme/tokens';
import { useBottomInset } from '../../shared/hooks/safe-area';
import { JsonViewer } from '../../shared/components/JsonViewer';
import { layout } from '../../shared/styles';
import { StyleSheet } from 'react-native';

import { useEventWithDetail } from '../../shared/hooks/event-detail';

type DetailTab = 'formatted' | 'raw';

/**
 * `summary` is the list row: title, body and provider metadata, but not the
 * `data` payload — that is a heavy column fetched only when this view opens.
 */
export function NotificationDetail({
  summary,
}: {
  summary: NotificationEvent;
}): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  const [tab, setTab] = useState<DetailTab>('formatted');
  const { event } = useEventWithDetail<NotificationEvent>(
    'notification',
    summary
  );

  return (
    <View style={layout.fill}>
      <View style={s.surface2}>
        <View style={layout.rowGapMd}>
          <BackButton />
          <Pill label={event.origin} color={theme.textMuted} />
          <Pill label={event.provider} color={theme.textMuted} />
          <Pill label={event.phase} color={theme.textMuted} />
        </View>
      </View>

      <View style={s.surface}>
        <DetailTabs
          tabs={DETAIL_TABS}
          selected={tab}
          onSelect={setTab}
          labelFor={capitalize}
        />
      </View>

      {tab === 'formatted' ? (
        <FormattedBody event={event} />
      ) : (
        <RawBody event={event} />
      )}
    </View>
  );
}

const DETAIL_TABS: readonly DetailTab[] = ['formatted', 'raw'];

function FormattedBody({
  event,
}: {
  event: NotificationEvent;
}): React.ReactNode {
  const s = useStyles();
  const { strings } = useBesouroUI();
  const bottomInset = useBottomInset();

  const meta = (
    <>
      {event.title ? <Text style={s.label3}>{event.title}</Text> : null}
      {event.body ? <Text style={s.label2}>{event.body}</Text> : null}
      <KeyValueRow label="provider" value={event.provider} copyable={true} />
      <KeyValueRow label="origin" value={event.origin} copyable={true} />
      <KeyValueRow label="phase" value={event.phase} copyable={true} />
      <KeyValueRow
        label="foreground"
        value={String(event.foreground)}
        copyable={true}
      />
      <KeyValueRow
        label="time"
        value={new Date(event.timestamp).toUTCString()}
        copyable={true}
      />
      {event.messageId ? (
        <KeyValueRow label="messageId" value={event.messageId} copyable />
      ) : null}
    </>
  );

  // When there's a data payload, render it through the viewer's own list with
  // the metadata as its header, so we never nest a VirtualizedList inside a
  // ScrollView.
  if (event.data) {
    return (
      <JsonViewer
        raw={event.data}
        truncated={event.dataTruncated}
        ListHeaderComponent={
          <View style={styles.container}>
            {meta}
            <Text style={s.label}>DATA</Text>
          </View>
        }
      />
    );
  }

  return (
    <ScrollView
      style={layout.fill}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: space.lg + bottomInset,
      }}
    >
      {meta}
      {!event.title && !event.body ? (
        <EmptyState message={strings.noContent} />
      ) : null}
    </ScrollView>
  );
}

/**
 * DevTools-added fields that aren't part of the notification the provider delivered:
 * store bookkeeping (`id`/`sessionId`/`kind`) plus values we derive at capture time
 * (`provider` = which module observed it, `phase` = which listener fired, `origin` =
 * computed from the trigger, `foreground` = read from AppState, `timestamp` =
 * `Date.now()` when our listener fired, not the provider's own send time). All are
 * surfaced in the Formatted tab instead — raw shows only the delivered payload.
 */
const INTERNAL_FIELDS: readonly (keyof NotificationEvent)[] = [
  'id',
  'sessionId',
  'kind',
  'provider',
  'phase',
  'origin',
  'foreground',
  'timestamp',
];

function RawBody({ event }: { event: NotificationEvent }): React.ReactNode {
  const raw = useMemo(() => {
    const payload: Record<string, unknown> = { ...event };
    for (const field of INTERNAL_FIELDS) {
      delete payload[field];
    }
    return JSON.stringify(payload, null, 2);
  }, [event]);
  return <JsonViewer raw={raw} />;
}

/** Title-cases a raw detail-tab name ('formatted' -> 'Formatted') for display. */
function capitalize(tab: string): string {
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}

const styles = StyleSheet.create({
  container: {
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
          fontWeight: fontWeight.bold,
          marginTop: 8,
          marginBottom: 4,
        },
        label2: {
          color: theme.textMuted,
          fontSize: font(fontSize.base),
          marginBottom: 12,
        },
        label3: {
          color: theme.text,
          fontSize: font(fontSize.lg),
          fontWeight: fontWeight.bold,
          marginBottom: 4,
        },
        surface: {
          width: '100%',
          backgroundColor: theme.surface,
        },
        surface2: {
          gap: space.sm,
          padding: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
      }),
    [theme, font]
  );
}
