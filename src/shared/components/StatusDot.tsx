/** Connection-status dot: green connected, red disconnected, muted unknown. */

import { View } from 'react-native';

import { useBesouroUI } from '../context';
import type { ConnectionStatus } from './SocketTabBase';

export function StatusDot({
  status,
}: {
  status: ConnectionStatus;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const color =
    status === 'connected'
      ? theme.success
      : status === 'disconnected'
        ? theme.danger
        : theme.textMuted;
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
