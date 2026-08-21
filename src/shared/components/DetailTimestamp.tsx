/**
 * The full capture date/time for a detail header — a faint, right-aligned caption.
 * List rows only show the time, so details surface the whole date here.
 */

import { type ReactNode } from 'react';
import { Text } from 'react-native';

import { formatDateTime } from '../utils/date-format';
import { useTextStyles } from '../hooks/text-styles';

export function DetailTimestamp({
  timestamp,
}: {
  timestamp: number;
}): ReactNode {
  const text = useTextStyles();
  return <Text style={text.captionFaint}>{formatDateTime(timestamp)}</Text>;
}
