/**
 * WebSocket inspector tab — supplies the socket adapter for the shared socket UI.
 */

import { useMemo } from 'react';
import { useBesouroUI } from '../../shared/context';
import type { WebSocketEvent } from '../../core/types';
import {
  SocketTab,
  type SocketAdapter,
} from '../../shared/components/SocketTabBase';

export function WebSocketTab(): React.ReactNode {
  const { strings } = useBesouroUI();
  const adapter = useMemo<SocketAdapter<WebSocketEvent>>(
    () => ({
      kind: 'websocket',
      noEventsMessage: strings.noConnections,
      clientIdOf: (event) => event.connectionId,
      clientLabelOf: (event) => event.url || event.connectionId,
      directionOf: (event) => event.direction,
      isErrorOf: (event) => event.type === 'error' || Boolean(event.error),
      titleOf: (event) =>
        event.error
          ? `${event.type}: ${event.error}`
          : event.direction === 'lifecycle'
            ? event.type
            : (event.payload?.slice(0, 60) ?? event.type),
      // Sent/received frames are always plain messages — the pill says it all.
      // Lifecycle frames carry no payload, so the close/error detail would be
      // lost if it weren't spelled out here.
      detailFieldOf: (event) => {
        if (event.direction !== 'lifecycle') return undefined;
        const close = [event.closeCode, event.closeReason]
          .filter(Boolean)
          .join(': ');
        const detail = event.error || close;
        return {
          label: strings.lifecycle,
          value: detail ? `${event.type} (${detail})` : event.type,
        };
      },
      payloadOf: (event) => event.payload,
      truncatedOf: (event) => event.payloadTruncated,
      urlOf: (event) => event.url,
      // The newest lifecycle frame is supplied by the grouped query, so the whole
      // frame history no longer has to be in memory to know the state.
      statusOf: (last) => {
        if (!last) return 'unknown';
        if (last.type === 'open') return 'connected';
        if (last.type === 'close' || last.type === 'error')
          return 'disconnected';
        return 'unknown';
      },
    }),
    [strings]
  );
  return <SocketTab adapter={adapter} />;
}
