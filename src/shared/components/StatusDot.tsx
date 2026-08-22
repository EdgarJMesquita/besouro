/** Connection-status dot: green connected, red disconnected, muted ended/unknown. */

import { View } from 'react-native';

import { useBesouroUI } from '../context';
import type { Theme } from '../../theme/theme';
import type { ConnectionStatus } from './SocketTabBase';

/**
 * The dot's color, exported so a status label beside it can't disagree. `ended`
 * and `unknown` share the muted dot: neither is a failure, and red is reserved
 * for a connection that actually dropped.
 */
export function statusColor(theme: Theme, status: ConnectionStatus): string {
  return status === 'connected'
    ? theme.success
    : status === 'disconnected'
      ? theme.danger
      : theme.textMuted;
}

export function StatusDot({
  status,
}: {
  status: ConnectionStatus;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const color = statusColor(theme, status);
  return (
    <View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: color,
      }}
    />
  );
}
