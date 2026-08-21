/**
 * Operation badge — tinted by whether the operation writes or deletes.
 *
 * A near-twin of the AsyncStorage pill, kept separate because the two take
 * different operation unions ({@link MMKVOperation} has no batch or read members).
 * Worth folding into a shared component if a third storage inspector ever appears;
 * not worth churning the AsyncStorage tab for the second.
 */

import type { MMKVOperation, StorageDirection } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import type { Theme } from '../../../theme/theme';

import { Pill } from '../../../shared/components/Pill';

export function OperationPill({
  operation,
  direction,
}: {
  operation: MMKVOperation;
  direction: StorageDirection;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  return <Pill label={operation} color={colorForDirection(theme, direction)} />;
}

// Direction is a category, not an outcome, so writes stay neutral; only delete —
// genuinely destructive — keeps a color.
function colorForDirection(theme: Theme, direction: StorageDirection): string {
  switch (direction) {
    case 'read':
    case 'write':
      return theme.textMuted;
    case 'delete':
      return theme.danger;
  }
}
