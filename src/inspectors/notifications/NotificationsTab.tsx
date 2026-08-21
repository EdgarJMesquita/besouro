/**
 * Notifications tab — a pinned Device Token panel (one copyable card per token)
 * above a searchable list of captured notifications. Tapping a notification opens
 * its data payload in the viewer.
 * The Device Token panel is only shown when a push token source is available:
 * native APNs on iOS, or a detected firebase-messaging / expo-notifications
 * install on either platform (Android has no native token without one).
 * On Android, a warning banner prompts for Notification Access permission when
 * it is missing (required for local notifications).
 */

import { useCallback, useMemo, useState } from 'react';
import { View, type ListRenderItem } from 'react-native';
import { useSessionEvents, useBesouroUI } from '../../shared/context';

import type { NotificationEvent } from '../../core/types';

import { TabHeader } from '../../shared/components/TabHeader';
import { PagedList } from '../../shared/components/PagedList';
import { useSearchQuery } from '../../shared/hooks/search-query';
import { useDetailEntrance } from '../../shared/hooks/detail-slide';

import { DetailOverlay } from '../../shared/components/DetailOverlay';
import { useEphemeralState } from '../../core/ephemeral-state';
import {
  OriginFilterBar,
  type OriginFilter,
} from './components/OriginFilterBar';
import { DeviceTokenSection } from './components/DeviceTokenSection';

import { NotificationDetail } from './NotificationsDetail';
import { NotificationRow } from './components/NotificationRow';
import { layout } from '../../shared/styles';

export function NotificationsTab(): React.ReactNode {
  const { strings } = useBesouroUI();
  const [query, setQuery] = useSearchQuery();
  const [filter, setFilter] = useState<OriginFilter>('all');
  const [selectedId, setSelectedId] = useEphemeralState<string | null>(
    'notifications.selectedId',
    null
  );

  // Both the search and the origin filter run in SQL. Filtering a loaded page in
  // JS would let a page of 50 rows render as none, and leave "load more" guessing
  // how many pages it takes to fill a screen.
  const where = useMemo(
    () =>
      filter === 'all'
        ? undefined
        : { field: 'origin', value: filter as string },
    [filter]
  );
  const paged = useSessionEvents('notification', { search: query, where });

  const selected = useMemo(
    () =>
      (paged.rows as NotificationEvent[]).find(
        (event) => event.id === selectedId
      ) ?? null,
    [paged.rows, selectedId]
  );

  const renderItem = useCallback<ListRenderItem<NotificationEvent>>(
    ({ item }) => <NotificationRow event={item} onSelect={setSelectedId} />,
    [setSelectedId]
  );
  const closeDetail = useCallback(() => setSelectedId(null), [setSelectedId]);
  const animateDetail = useDetailEntrance(selectedId);

  return (
    <View style={layout.fill}>
      {selected ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <NotificationDetail summary={selected} />
        </DetailOverlay>
      ) : null}
      <DeviceTokenSection />
      <TabHeader kind="notification" query={query} onQueryChange={setQuery} />
      <OriginFilterBar value={filter} onChange={setFilter} />
      <PagedList<NotificationEvent>
        paged={paged}
        renderItem={renderItem}
        searching={Boolean(query) || filter !== 'all'}
        emptyMessage={strings.noNotifications}
        noResultsMessage={strings.noResults}
      />
    </View>
  );
}
