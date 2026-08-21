/**
 * Shared socket inspector UI for WebSocket and Socket.IO: list connections, then
 * tap one to see its frames chronologically (§6.3/§6.4). The two tabs differ only
 * in how a frame maps to client id, label, title, and payload.
 *
 * Both levels are database-backed. The connection list comes from a grouped
 * aggregate (counts, last activity, and the newest lifecycle frame that gives the
 * connection its status), and the frame timeline pages within one connection — so
 * a socket that has carried a hundred thousand frames costs the same to open as
 * one that has carried ten.
 */

import { useCallback, useMemo, useState } from 'react';
import { FlatList, Text, View, type ListRenderItem } from 'react-native';
import type {
  BesouroEvent,
  InspectorKind,
  SocketDirection,
} from '../../core/types';
import { useSessionEvents } from '../context';
import { useEventGroups } from '../hooks/event-groups';
import { useEventDetail } from '../hooks/event-detail';
import { PagedList } from './PagedList';
import { useBesouroUI } from '../context';
import { BackButton } from './BackButton';
import { EmptyState } from './EmptyState';
import { KeyValueRow } from './KeyValueRow';
import { ListSeparator } from './ListSeparator';
import { MonoText } from './MonoText';

import { space, fontSize, fontWeight } from '../../theme/tokens';
import { useListBottomPadding } from '../hooks/safe-area';
import { DetailLoading } from './DetailLoading';
import { JsonViewer } from './JsonViewer';
import { DetailTimestamp } from './DetailTimestamp';
import { TabHeader } from './TabHeader';
import { useSearchQuery } from '../hooks/search-query';
import { DetailOverlay } from './DetailOverlay';
import { useDetailEntrance } from '../hooks/detail-slide';
import { useEphemeralState } from '../../core/ephemeral-state';
import { SocketClientRow } from './SocketClientRow';
import { SocketFrameRow } from './SocketFrameRow';
import { StatusDot } from './StatusDot';
import { DirectionPill } from './DirectionPill';
import { layout } from '../styles';
import { StyleSheet } from 'react-native';

export type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

/** A connection row derived from an inspector's frames. */
export interface SocketClient {
  id: string;
  label: string;
  count: number;
  last: number;
  status: ConnectionStatus;
  url: string | undefined;
}

export interface SocketAdapter<Event> {
  kind: InspectorKind;
  noEventsMessage: string;
  clientIdOf(event: Event): string;
  clientLabelOf(event: Event): string;
  directionOf(event: Event): SocketDirection;
  /** True when a lifecycle event is a failure (error / connect_error). */
  isErrorOf(event: Event): boolean;
  /** Row label in the frame timeline — must distinguish one frame from the next. */
  titleOf(event: Event): string;
  /**
   * Label/value shown above the payload in the frame detail, for what the
   * direction pill and the payload itself don't already say. Socket.IO names
   * the event; raw WebSocket only qualifies its lifecycle frames, since a
   * sent/received frame is always just a message. Undefined renders nothing.
   */
  detailFieldOf?(event: Event): { label: string; value: string } | undefined;
  payloadOf(event: Event): string | undefined;
  truncatedOf(event: Event): boolean;
  urlOf(event: Event): string | undefined;
  /**
   * Connection status from the newest lifecycle frame, or null when the
   * connection has logged none yet. Reading one row rather than scanning a whole
   * frame history is what lets the connection list come straight from SQL.
   */
  statusOf(latestLifecycle: Event | null): ConnectionStatus;
}

export function SocketTab<
  Event extends BesouroEvent & { id: string; timestamp: number },
>({ adapter }: { adapter: SocketAdapter<Event> }): React.ReactNode {
  const { strings } = useBesouroUI();
  const [query, setQuery] = useSearchQuery();
  // Shared component across WebSocket and Socket.IO, so scope the remembered
  // selection by kind or the two tabs would clobber each other.
  const [selectedClientId, setSelectedClientId] = useEphemeralState<
    string | null
  >(`${adapter.kind}.selectedClientId`, null);
  const listBottomPadding = useListBottomPadding();

  // Counts and last-activity come from a grouped aggregate; the connection's
  // status comes from the newest lifecycle frame the same query returns.
  const { groups, loading } = useEventGroups({
    kind: adapter.kind,
    latestWhere: LIFECYCLE_FILTER,
    search: query,
  });

  const clients = useMemo<SocketClient[]>(
    () =>
      groups.map((group) => {
        const newest = group.newest as Event | null;
        return {
          id: group.key,
          label: newest ? adapter.clientLabelOf(newest) : group.key,
          count: group.count,
          last: group.lastAt,
          status: adapter.statusOf((group.latest as Event | null) ?? null),
          url: newest ? adapter.urlOf(newest) : undefined,
        };
      }),
    [groups, adapter]
  );

  const selectedClient =
    clients.find((client) => client.id === selectedClientId) ?? null;

  const keyExtractor = useCallback((client: { id: string }) => client.id, []);
  const renderClient = useCallback<ListRenderItem<SocketClient>>(
    ({ item }) => (
      <SocketClientRow
        id={item.id}
        label={item.label}
        count={item.count}
        last={item.last}
        status={item.status}
        onSelect={setSelectedClientId}
      />
    ),
    [setSelectedClientId]
  );
  const listContentStyle = useMemo(
    () => ({ paddingBottom: listBottomPadding }),
    [listBottomPadding]
  );
  const closeDetail = useCallback(
    () => setSelectedClientId(null),
    [setSelectedClientId]
  );
  const animateDetail = useDetailEntrance(selectedClientId);

  return (
    <View style={layout.fill}>
      {selectedClient ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <SocketClientDetail
            connectionId={selectedClient.id}
            adapter={adapter}
            url={selectedClient.url}
            status={selectedClient.status}
            search={query}
          />
        </DetailOverlay>
      ) : null}
      <TabHeader kind={adapter.kind} query={query} onQueryChange={setQuery} />
      {clients.length === 0 ? (
        loading ? (
          <DetailLoading />
        ) : (
          <EmptyState
            message={query ? strings.noResults : adapter.noEventsMessage}
          />
        )
      ) : (
        <FlatList
          data={clients}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={ListSeparator}
          contentContainerStyle={listContentStyle}
          renderItem={renderClient}
        />
      )}
    </View>
  );
}

/** Newest frame whose direction is `lifecycle` — what a connection's status reads. */
const LIFECYCLE_FILTER = { field: 'direction', value: 'lifecycle' } as const;

function SocketClientDetail<
  Event extends BesouroEvent & { id: string; timestamp: number },
>({
  connectionId,
  adapter,
  url,
  status,
  search,
}: {
  connectionId: string;
  adapter: SocketAdapter<Event>;
  url: string | undefined;
  status: ConnectionStatus;
  search: string;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings, font } = useBesouroUI();
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);

  // Frames page within this connection, so opening a busy socket doesn't load
  // its whole history.
  const paged = useSessionEvents(adapter.kind, {
    group: connectionId,
    search: search || undefined,
  });

  const selectedSummary =
    (paged.rows.find((frame) => frame.id === selectedFrameId) as
      Event | undefined) ?? null;
  // The payload is a heavy column, so it is fetched when a frame is opened.
  const { event: fullFrame, loading: loadingFrame } = useEventDetail<Event>(
    adapter.kind,
    selectedFrameId
  );
  const selectedFrame = fullFrame ?? selectedSummary;

  const framePayload = fullFrame ? adapter.payloadOf(fullFrame) : null;
  const frameField = selectedFrame
    ? adapter.detailFieldOf?.(selectedFrame)
    : undefined;
  // Rendered above the payload in both the payload and no-payload branches, so
  // a lifecycle frame still says what it was.
  const frameFieldBlock = frameField ? (
    <View style={styles.container}>
      <Text style={s.label}>{frameField.label.toUpperCase()}</Text>
      <MonoText
        style={s.fieldValue}
        size={fontSize.base}
        color={theme.text}
        selectable
      >
        {frameField.value}
      </MonoText>
    </View>
  ) : null;

  const renderFrame = useCallback<ListRenderItem<Event>>(
    ({ item }) => (
      <SocketFrameRow
        id={item.id}
        direction={adapter.directionOf(item)}
        isError={adapter.isErrorOf(item)}
        title={adapter.titleOf(item)}
        timestamp={item.timestamp}
        onSelect={setSelectedFrameId}
      />
    ),
    [adapter]
  );
  const closeFrame = useCallback(() => setSelectedFrameId(null), []);

  return (
    <View style={layout.fill}>
      {selectedFrame ? (
        <DetailOverlay onClose={closeFrame}>
          <View style={s.row2}>
            <BackButton />
            <DirectionPill
              direction={adapter.directionOf(selectedFrame)}
              isError={adapter.isErrorOf(selectedFrame)}
            />
            <View style={layout.fill} />
            <DetailTimestamp timestamp={selectedFrame.timestamp} />
          </View>
          {loadingFrame ? (
            <DetailLoading />
          ) : framePayload ? (
            <JsonViewer
              raw={framePayload}
              truncated={fullFrame ? adapter.truncatedOf(fullFrame) : false}
              ListHeaderComponent={
                <>
                  {frameFieldBlock}
                  <View style={styles.container}>
                    <Text style={s.label}>{strings.payload.toUpperCase()}</Text>
                  </View>
                </>
              }
            />
          ) : (
            <>
              {frameFieldBlock}
              <EmptyState message={strings.noPayload} />
            </>
          )}
        </DetailOverlay>
      ) : null}
      <View style={s.surface}>
        <View style={s.row}>
          <BackButton />
          <StatusDot status={status} />
          <Text
            style={{
              color: status === 'connected' ? theme.success : theme.danger,
              fontSize: font(fontSize.caption),
              fontWeight: fontWeight.bold,
              textTransform: 'capitalize',
            }}
          >
            {status}
          </Text>
        </View>
        {url ? (
          <KeyValueRow label="URL" value={url} paddingHorizontal={space.lg} />
        ) : null}
        <KeyValueRow
          label="Socket id"
          value={connectionId}
          copyable={false}
          paddingHorizontal={space.lg}
        />
      </View>
      <PagedList<Event>
        paged={paged}
        renderItem={renderFrame}
        searching={Boolean(search)}
        emptyMessage={strings.noPayload}
        noResultsMessage={strings.noResults}
      />
    </View>
  );
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
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          borderBottomWidth: 1,
          padding: space.lg,
          borderBottomColor: theme.border,
        },
        surface: {
          backgroundColor: theme.surface,
        },
        label: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          fontWeight: fontWeight.bold,
        },
        fieldValue: {
          marginTop: space.xs,
        },
        row2: {
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
