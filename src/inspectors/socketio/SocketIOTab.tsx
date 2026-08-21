/**
 * Socket.IO inspector tab — supplies the socket adapter for the shared socket UI.
 */

import { useMemo } from 'react';
import { useBesouroUI } from '../../shared/context';
import type { SocketIOEvent } from '../../core/types';
import {
  SocketTab,
  type SocketAdapter,
} from '../../shared/components/SocketTabBase';

export function SocketIOTab(): React.ReactNode {
  const { strings } = useBesouroUI();
  const adapter = useMemo<SocketAdapter<SocketIOEvent>>(
    () => ({
      kind: 'socketio',
      noEventsMessage: strings.noConnections,
      clientIdOf: (event) => event.clientId,
      clientLabelOf: (event) => {
        const base = event.url || event.clientId;
        // Only surface the namespace when it isn't the default root ("/").
        return event.namespace && event.namespace !== '/'
          ? `${base} · ${event.namespace}`
          : base;
      },
      directionOf: (event) => event.direction,
      isErrorOf: (event) =>
        event.event === 'connect_error' || event.event === 'error',
      titleOf: (event) => (event.hasAck ? `${event.event} (ack)` : event.event),
      detailFieldOf: (event) => ({
        label: strings.event,
        value: event.hasAck ? `${event.event} (ack)` : event.event,
      }),
      payloadOf: (event) => event.args,
      truncatedOf: (event) => event.argsTruncated,
      urlOf: (event) => event.url,
      // The newest lifecycle frame is supplied by the grouped query, so the whole
      // frame history no longer has to be in memory to know the state.
      statusOf: (last) => {
        if (!last) return 'unknown';
        if (last.event === 'connect') return 'connected';
        if (last.event === 'disconnect' || last.event === 'connect_error')
          return 'disconnected';
        return 'unknown';
      },
    }),
    [strings]
  );
  return <SocketTab adapter={adapter} />;
}
