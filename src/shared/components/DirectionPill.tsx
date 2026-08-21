/** Direction badge for a socket frame (sent / received / lifecycle). */

import type { SocketDirection } from '../../core/types';
import { useBesouroUI } from '../context';

import { Pill } from './Pill';

export function DirectionPill({
  direction,
  isError = false,
}: {
  direction: SocketDirection;
  isError?: boolean;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  // A failed lifecycle event (connect_error / error) is an outcome → red.
  if (direction === 'lifecycle' && isError) {
    return <Pill label={strings.error} color={theme.danger} />;
  }
  // Directional colors: outbound = blue (sent), inbound = green (received);
  // neutral lifecycle events carry no outcome.
  const config: Record<SocketDirection, { label: string; color: string }> = {
    send: { label: `↑ ${strings.sent}`, color: theme.sent },
    receive: { label: `↓ ${strings.received}`, color: theme.success },
    lifecycle: { label: strings.lifecycle, color: theme.textMuted },
  };
  const { label, color } = config[direction];
  return <Pill label={label} color={color} />;
}
