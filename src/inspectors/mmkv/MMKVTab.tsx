/**
 * MMKV tab — lists the attached instances, then an instance detail with the
 * instance's current contents stacked over its recorded write log.
 *
 * In a live session the list comes from the snapshot registry
 * (`useMMKVSnapshots`), so an instance that has been attached but never written to
 * still appears — for a key/value store read far more often than it is written,
 * that is the normal case, not an edge one. Operation counts always come from the
 * drawer's active session, keyed by `instanceId`. A **past** session reads its list
 * from its own rows instead; the registry describes this launch, not that one (see
 * `utils/instance-list`).
 */

import { useCallback, useMemo } from 'react';
import { FlatList, View, type ListRenderItem } from 'react-native';
import { useBesouroUI, useViewingSession } from '../../shared/context';
import { useEventGroups } from '../../shared/hooks/event-groups';
import type { MMKVInstanceListItem } from './types-ui';
import { useMMKVInstances } from './store/instances';
import { instanceList } from './utils/instance-list';

import { EmptyState } from '../../shared/components/EmptyState';
import { ListSeparator } from '../../shared/components/ListSeparator';

import { useListBottomPadding } from '../../shared/hooks/safe-area';

import { TabHeader } from '../../shared/components/TabHeader';
import { useSearchQuery } from '../../shared/hooks/search-query';
import { useSearchFilter } from '../../shared/hooks/search-filter';
import { useDetailEntrance } from '../../shared/hooks/detail-slide';

import { DetailOverlay } from '../../shared/components/DetailOverlay';
import { useEphemeralState } from '../../core/ephemeral-state';
import { InstanceRow } from './components/InstanceRow';
import { InstanceDetail } from './MMKVDetail';
import { layout } from '../../shared/styles';

export function MMKVTab(): React.ReactNode {
  const { strings } = useBesouroUI();
  const viewing = useViewingSession() !== null;
  const attached = useMMKVInstances();
  const [query, setQuery] = useSearchQuery();
  const [selectedInstanceId, setSelectedInstanceId] = useEphemeralState<
    string | null
  >('mmkv.selectedInstanceId', null);
  const listBottomPadding = useListBottomPadding();

  // Change counts come from a grouped COUNT(*) rather than from tallying loaded
  // events, so the badge is accurate for the whole session without holding a single
  // write in memory.
  const { groups } = useEventGroups({
    kind: 'mmkv',
    countWhere: { field: 'isFinal', value: '0' },
  });

  // A past session is described by its rows alone: the attached instances belong to
  // this launch, and listing them under a header dated weeks ago is the mistake
  // `BROWSER_INSPECTORS` exists to prevent.
  const items = useMemo<MMKVInstanceListItem[]>(
    () => instanceList(groups, viewing ? [] : attached),
    [groups, viewing, attached]
  );

  const searchFieldsOf = useCallback(
    (item: MMKVInstanceListItem) => [item.instanceName],
    []
  );
  const filtered = useSearchFilter(items, query, searchFieldsOf);

  const selected =
    items.find((item) => item.instanceId === selectedInstanceId) ?? null;

  const keyExtractor = useCallback(
    (item: MMKVInstanceListItem) => item.instanceId,
    []
  );
  const renderItem = useCallback<ListRenderItem<MMKVInstanceListItem>>(
    ({ item }) => <InstanceRow item={item} onSelect={setSelectedInstanceId} />,
    [setSelectedInstanceId]
  );
  const listContentStyle = useMemo(
    () => ({ paddingBottom: listBottomPadding }),
    [listBottomPadding]
  );
  const closeDetail = useCallback(
    () => setSelectedInstanceId(null),
    [setSelectedInstanceId]
  );
  const animateDetail = useDetailEntrance(selectedInstanceId);

  return (
    <View style={layout.fill}>
      {selected ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <InstanceDetail item={selected} />
        </DetailOverlay>
      ) : null}
      <TabHeader kind="mmkv" query={query} onQueryChange={setQuery} />
      {filtered.length === 0 ? (
        <EmptyState message={query ? strings.noResults : strings.noInstances} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={ListSeparator}
          contentContainerStyle={listContentStyle}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}
