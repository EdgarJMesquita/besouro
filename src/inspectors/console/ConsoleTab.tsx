import { useCallback } from 'react';
import { View, type ListRenderItem } from 'react-native';
import { useSessionEvents, useBesouroUI } from '../../shared/context';
import type { ConsoleEvent } from '../../core/types';

import { TabHeader } from '../../shared/components/TabHeader';
import { PagedList } from '../../shared/components/PagedList';
import { useSearchQuery } from '../../shared/hooks/search-query';
import { ConsoleRow } from './components/ConsoleRow';
import { layout } from '../../shared/styles';

export function ConsoleTab(): React.ReactNode {
  const { strings } = useBesouroUI();
  const [query, setQuery] = useSearchQuery();
  // Filtering runs in SQL, so a search reaches the whole session rather than
  // only the pages loaded so far.
  const paged = useSessionEvents('console', { search: query });

  const renderItem = useCallback<ListRenderItem<ConsoleEvent>>(
    ({ item }) => <ConsoleRow event={item} />,
    []
  );

  return (
    <View style={layout.fill}>
      <TabHeader kind="console" query={query} onQueryChange={setQuery} />
      <PagedList<ConsoleEvent>
        paged={paged}
        renderItem={renderItem}
        searching={Boolean(query)}
        emptyMessage={strings.noLogs}
        noResultsMessage={strings.noResults}
      />
    </View>
  );
}
