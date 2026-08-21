/**
 * MMKV detail screen — one instance's current state and its change history, as two
 * full-width panes behind a tab strip.
 *
 * Tabbed rather than stacked, following the Redux tab: an instance's contents and
 * its write log are each worth a whole screen, and splitting the height between them
 * left both cramped. It also removes the live/past asymmetry that the stacked layout
 * had to special-case — both panes read from the session's rows, so a past session
 * gets the same two tabs rather than one pane and a hole.
 *
 * **Operations** is every non-snapshot row: one per captured write or removal.
 * **Store** is the instance's snapshot row (`isFinal`), written at attach and
 * refreshed as changes land. The two are the same query with opposite `isFinal`
 * filters, and they sit in that order because the Redux tab puts its action log
 * before its state.
 */

import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type ListRenderItem } from 'react-native';

import type { MMKVEvent } from '../../core/types';
import { useMMKVInstances } from './store/instances';
import type { MMKVInstanceListItem } from './types-ui';
import { useBesouroUI, useSessionEvents } from '../../shared/context';
import { useEventWithDetail } from '../../shared/hooks/event-detail';
import { useBottomInset } from '../../shared/hooks/safe-area';
import { PagedList } from '../../shared/components/PagedList';
import type { PagedEvents } from '../../shared/hooks/paged-events';
import { BackButton } from '../../shared/components/BackButton';
import { DetailTabs } from '../../shared/components/DetailTabs';
import { EmptyState } from '../../shared/components/EmptyState';
import { KeyValueRow } from '../../shared/components/KeyValueRow';
import { MonoText } from '../../shared/components/MonoText';
import { space, fontSize, fontWeight } from '../../theme/tokens';
import { DetailLoading } from '../../shared/components/DetailLoading';
import { DetailTimestamp } from '../../shared/components/DetailTimestamp';
import { DetailOverlay } from '../../shared/components/DetailOverlay';
import { JsonViewer } from '../../shared/components/JsonViewer';
import { useEphemeralState } from '../../core/ephemeral-state';
import { useDetailEntrance } from '../../shared/hooks/detail-slide';
import { OperationPill } from './components/OperationPill';
import { OperationRow } from './components/OperationRow';
import { layout } from '../../shared/styles';
import { ScrollView } from 'react-native';

const PANES = ['operations', 'store'] as const;
type Pane = (typeof PANES)[number];

export function InstanceDetail({
  item,
}: {
  item: MMKVInstanceListItem;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const [pane, setPane] = useEphemeralState<Pane>('mmkv.pane', 'operations');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // The operation log is queried here rather than inside the pane so the detail
  // overlay can live at the top of this view. An overlay rendered inside the pane
  // opens *below* the tab strip; every other inspector's detail covers its whole
  // screen, back arrow sitting directly under the drawer's inspector tabs.
  // The snapshot row is excluded in SQL, so it cannot displace a real change from
  // the first page.
  const paged = useSessionEvents('mmkv', {
    group: item.instanceId,
    where: { field: 'isFinal', value: '0' },
  });

  const selected =
    (paged.rows.find((event) => event.id === selectedEventId) as
      MMKVEvent | undefined) ?? null;
  const closeDetail = useCallback(() => setSelectedEventId(null), []);
  const animateDetail = useDetailEntrance(selectedEventId);

  // Operations lead, and the store trails — the same order the Redux tab puts its
  // actions and state in, so the two log-plus-state tabs open the same way.
  const labelFor = useCallback(
    (option: Pane) =>
      option === 'operations' ? strings.operations : strings.store,
    [strings]
  );

  const info = useMMKVInstances().find(
    (candidate) => candidate.instanceId === item.instanceId
  );

  return (
    <View style={layout.fill}>
      {selected ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <OperationDetail summary={selected} />
        </DetailOverlay>
      ) : null}

      {/* The storage id rides in the header bar, like the timestamp does on the
          other detail screens: it is the instance's own identity, distinct from the
          name the consumer registered it under, so it is shown but never the label. */}
      <View style={s.header}>
        <BackButton />
        <MonoText style={layout.fill} size={fontSize.base} color={theme.text}>
          {item.instanceName}
        </MonoText>
        {info?.storageId ? <Text style={s.muted}>{info.storageId}</Text> : null}
      </View>
      <View style={s.tabs}>
        <DetailTabs
          tabs={PANES}
          selected={pane}
          onSelect={setPane}
          labelFor={labelFor}
          fill
        />
      </View>
      {pane === 'operations' ? (
        <OperationsPane paged={paged} onSelect={setSelectedEventId} />
      ) : (
        <StorePane instanceId={item.instanceId} />
      )}
    </View>
  );
}

/**
 * The instance's contents, from its snapshot row.
 *
 * One row per instance per session carries `isFinal`, so this is an equality filter
 * rather than a scan, and the same query serves a live session and a past one.
 */
function StorePane({ instanceId }: { instanceId: string }): React.ReactNode {
  const { strings } = useBesouroUI();
  const paged = useSessionEvents('mmkv', {
    group: instanceId,
    where: { field: 'isFinal', value: '1' },
  });
  const snapshot = paged.rows[0] as MMKVEvent | undefined;
  if (!snapshot) {
    return <EmptyState message={strings.noValue} />;
  }
  return <StoreBody summary={snapshot} />;
}

/**
 * The snapshot's contents are a heavy column, fetched only when this pane opens —
 * and re-fetched whenever the row's timestamp moves.
 *
 * That second half is what keeps the pane live. Every other detail view in the
 * drawer reads an append-only row: it is written once, so having fetched it by id
 * is the end of the story. This one row is *patched in place* as writes land, and
 * its id never changes, so without a cue tied to the row's own timestamp the
 * contents fetched when the pane opened would stay on screen for the rest of the
 * session and only a close-and-reopen would show the writes since.
 */
function StoreBody({ summary }: { summary: MMKVEvent }): React.ReactNode {
  const { strings } = useBesouroUI();
  const bottomInset = useBottomInset();
  const { event, loadingDetail } = useEventWithDetail<MMKVEvent>(
    'mmkv',
    summary,
    { revision: summary.timestamp }
  );
  const entries = useMemo(() => parseContents(event.value), [event.value]);
  const contentStyle = useMemo(
    () => ({ padding: space.lg, paddingBottom: space.lg + bottomInset }),
    [bottomInset]
  );

  if (loadingDetail) {
    return <DetailLoading />;
  }
  if (entries.length === 0) {
    return <EmptyState message={strings.noValue} />;
  }
  // A label/value list, not the §7.1 viewer: an instance is a flat set of
  // independently-typed keys, not a document, and folding them into one JSON object
  // would invent a structure the store does not have. The network tab's header list
  // is the right precedent, so this shares its row.
  return (
    <ScrollView style={layout.fill} contentContainerStyle={contentStyle}>
      {entries.map(([key, value]) => (
        <KeyValueRow key={key} label={key} value={value} />
      ))}
    </ScrollView>
  );
}

/**
 * The recorded writes and removals, newest first.
 *
 * Presentational: the query, the selection and the detail overlay all belong to
 * {@link InstanceDetail}, so the overlay can cover the tab strip above this pane.
 */
function OperationsPane({
  paged,
  onSelect,
}: {
  paged: PagedEvents;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const { strings } = useBesouroUI();

  const renderItem = useCallback<ListRenderItem<MMKVEvent>>(
    ({ item }) => <OperationRow event={item} onSelect={onSelect} />,
    [onSelect]
  );

  return (
    <View style={layout.fill}>
      <PagedList<MMKVEvent>
        paged={paged}
        renderItem={renderItem}
        emptyMessage={strings.noEvents}
      />
    </View>
  );
}

/**
 * A snapshot row's contents, as label/value pairs.
 *
 * Defensive because the text comes off disk: a row written by another version of the
 * library, or one the truncator cut mid-object, must render as empty rather than
 * throw inside a pane.
 */
function parseContents(raw: string | undefined): Array<[string, string]> {
  if (!raw) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed as Record<string, unknown>).map(
      ([key, value]) => [key, typeof value === 'string' ? value : String(value)]
    );
  } catch {
    return [];
  }
}

/**
 * `summary` is the log row: operation, key and type, but not the value — a heavy
 * column fetched only when this view opens.
 */
function OperationDetail({ summary }: { summary: MMKVEvent }): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const { event, loadingDetail } = useEventWithDetail<MMKVEvent>(
    'mmkv',
    summary
  );
  return (
    <View style={layout.fill}>
      <View style={s.header}>
        <BackButton />
        <OperationPill
          operation={event.operation}
          direction={event.direction}
        />
        <View style={layout.fill} />
        <DetailTimestamp timestamp={event.timestamp} />
      </View>
      {event.key ? (
        <View style={styles.field}>
          <Text style={s.label}>{strings.key.toUpperCase()}</Text>
          <MonoText size={fontSize.body} color={theme.text}>
            {event.key}
          </MonoText>
        </View>
      ) : null}
      {event.error ? (
        <View style={styles.field}>
          <Text style={s.label}>{strings.error.toUpperCase()}</Text>
          <MonoText size={fontSize.body} color={theme.danger}>
            {event.error}
          </MonoText>
        </View>
      ) : null}
      {loadingDetail ? (
        // The value is still being read; "no value" would be wrong.
        <DetailLoading />
      ) : event.value == null ? (
        <EmptyState message={strings.noValue} />
      ) : event.valueType === 'string' ? (
        // Only a string can be holding JSON, so it is the only type worth handing
        // to the §7.1 viewer. It falls back to plain text when the string is not
        // JSON, which is the common case for a stored string anyway.
        <JsonViewer
          raw={event.value}
          truncated={event.valueTruncated}
          ListHeaderComponent={
            <View style={styles.viewerHeader}>
              <Text style={s.label}>{strings.value.toUpperCase()}</Text>
            </View>
          }
        />
      ) : (
        // A number, a boolean or a buffer descriptor is one short scalar. The
        // viewer's tree, collapse/expand and copy-subtree have nothing to act on,
        // so it renders as a field like the key above it.
        <View style={styles.field}>
          <Text style={s.label}>{strings.value.toUpperCase()}</Text>
          <MonoText size={fontSize.body} color={theme.text}>
            {event.value}
          </MonoText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  viewerHeader: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
        tabs: {
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
        label: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          fontWeight: fontWeight.bold,
          width: '100%',
          marginBottom: 2,
        },
        muted: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
        },
      }),
    [theme, font]
  );
}
