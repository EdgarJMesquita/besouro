/**
 * Status badge for a request — colored by outcome (pending / 2xx / error).
 * Shared by the list row and the detail header.
 */

import type { NetworkEvent } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import type { Theme } from '../../../theme/theme';

import { Pill } from '../../../shared/components/Pill';

/** Bootstrap contextual colors, mapped to HTTP status ranges. */
// Status pills read outcome from the theme's semantic tokens, so they stay
// legible in both light and dark themes (§ color roles: outcome = color).
function statusColor(theme: Theme, event: NetworkEvent): string {
  if (event.phase === 'error' || (event.status ?? 0) >= 500) {
    return theme.danger;
  }
  if ((event.status ?? 0) >= 400) {
    return theme.warning;
  }
  return theme.success;
}

export function StatusPill({
  event,
}: {
  event: NetworkEvent;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  if (event.phase === 'pending') {
    return <Pill label={strings.pending} color={theme.textMuted} />;
  }
  return (
    <Pill
      label={String(event.status ?? '—')}
      color={statusColor(theme, event)}
    />
  );
}
