/**
 * Operation badge — tinted by whether the operation reads, writes, or deletes.
 * Shared by the list row and the detail header.
 */

import type { StorageDirection, StorageOperation } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import type { Theme } from '../../../theme/theme';

import { Pill } from '../../../shared/components/Pill';

// The operation name (e.g. `setItem`) is the label; direction only drives the
// color, so the pill carries both the exact op and its read/write/delete
// category without repeating either.
export function OperationPill({
  operation,
  direction,
}: {
  operation: StorageOperation;
  direction: StorageDirection;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  return <Pill label={operation} color={colorForDirection(theme, direction)} />;
}

// Colors the operation pill by its read/write/delete category. Direction is a
// category, not an outcome, so reads and writes stay neutral; only delete —
// genuinely destructive — keeps a color.
function colorForDirection(theme: Theme, direction: StorageDirection): string {
  switch (direction) {
    case 'read':
    case 'write':
      // read/write are operation categories, not outcomes — keep them neutral.
      return theme.textMuted;
    case 'delete':
      // The one genuinely destructive case keeps a warning color.
      return theme.danger;
  }
}
