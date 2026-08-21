/**
 * AsyncStorage tab — chronological operations log with an operation badge, keys,
 * and per-op duration (§6.7). Tapping an op shows its value in the payload viewer.
 */

import { useCallback, useMemo } from 'react';
import { View, type ListRenderItem } from 'react-native';
import { useSessionEvents, useBesouroUI } from '../../shared/context';
import type { AsyncStorageEvent } from '../../core/types';

import { TabHeader } from '../../shared/components/TabHeader';
import { PagedList } from '../../shared/components/PagedList';
import { useSearchQuery } from '../../shared/hooks/search-query';
import { useDetailEntrance } from '../../shared/hooks/detail-slide';

import { DetailOverlay } from '../../shared/components/DetailOverlay';
import { useEphemeralState } from '../../core/ephemeral-state';

import { AsyncStorageDetail } from './AsyncStorageDetail';
import { AsyncStorageRow } from './components/AsyncStorageRow';
import { layout } from '../../shared/styles';

export function AsyncStorageTab(): React.ReactNode {
  const { strings } = useBesouroUI();
  const [query, setQuery] = useSearchQuery();
  // Search runs in SQL across keys, value and operation — including `value`,
  // which is a heavy column the list never loads but the WHERE can still match.
  const paged = useSessionEvents('asyncStorage', { search: query });
  const [selectedId, setSelectedId] = useEphemeralState<string | null>(
    'asyncStorage.selectedId',
    null
  );

  const selected = useMemo(
    () =>
      (paged.rows as AsyncStorageEvent[]).find(
        (event) => event.id === selectedId
      ) ?? null,
    [paged.rows, selectedId]
  );

  const renderItem = useCallback<ListRenderItem<AsyncStorageEvent>>(
    ({ item }) => <AsyncStorageRow event={item} onSelect={setSelectedId} />,
    [setSelectedId]
  );
  const closeDetail = useCallback(() => setSelectedId(null), [setSelectedId]);
  const animateDetail = useDetailEntrance(selectedId);

  return (
    <View style={layout.fill}>
      {selected ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <AsyncStorageDetail summary={selected} />
        </DetailOverlay>
      ) : null}
      <TabHeader kind="asyncStorage" query={query} onQueryChange={setQuery} />
      <PagedList<AsyncStorageEvent>
        paged={paged}
        renderItem={renderItem}
        searching={Boolean(query)}
        emptyMessage={strings.noOperations}
        noResultsMessage={strings.noResults}
      />
    </View>
  );
}
