import { useMemo } from 'react';

/** Case-insensitive substring filter over caller-selected fields. */
export function useSearchFilter<Event>(
  events: readonly Event[],
  query: string,
  fieldsOf: (event: Event) => Array<string | undefined>
): Event[] {
  return useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [...events];
    }
    return events.filter((event) =>
      fieldsOf(event).some((field) => field?.toLowerCase().includes(needle))
    );
  }, [events, query, fieldsOf]);
}
