import { useState } from 'react';

/** The live search query backing a tab's {@link TabHeader}. */
export function useSearchQuery(): [string, (query: string) => void] {
  const [query, setQuery] = useState('');
  return [query, setQuery];
}
