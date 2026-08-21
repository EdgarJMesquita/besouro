/**
 * WebSocket capture mechanism — internal.
 *
 * Wraps the global `WebSocket` constructor directly (rather than depending on RN's
 * private `WebSocketInterceptor` module, which is a deprecated deep import) with a
 * subclass that records connect / open / send / message / close / error. Each frame
 * becomes its own event, grouped by `connectionId` (our own per-socket id).
 *
 * Receive and lifecycle frames are captured through `addEventListener` on the
 * instance, so the app's own `onmessage` / listeners are untouched; only `send` is
 * overridden, and it always forwards to the original.
 *
 * Sockets constructed *before* install aren't captured — this only sees `new
 * WebSocket(...)` from that point on (which is also why Metro's own HMR socket
 * rarely shows up, though it is filtered anyway).
 *
 * `installWebSocketInspector` is the entry point, called by the controller.
 */

import { patchMethod, safeCapture } from '../../core/base-interceptor';
import { captureEvent, createEventId } from '../../core/capture';
import { getCurrentSession } from '../../core/session';
import { truncateToBytes } from '../../core/truncate';
import { safeStringify } from '../../core/serialize';
import type { SocketDirection, WebSocketEvent } from '../../core/types';

/** Per-frame ceiling for a captured payload — 500 KB. */
const MAX_PAYLOAD_BYTES = 500_000;

interface CloseData {
  code?: number;
  reason?: string;
}

/** The `WebSocket` surface we rely on — deliberately narrow (RN's implementation
 *  is an `EventTarget`, so `addEventListener` is available on every instance). */
interface WebSocketLike {
  send(data: unknown): void;
  addEventListener(type: string, listener: (event: never) => void): void;
}

type WebSocketConstructor = new (
  url: string,
  protocols?: unknown,
  options?: unknown
) => WebSocketLike;

interface GlobalWithWebSocket {
  WebSocket: WebSocketConstructor;
}

/** Per-socket capture state, off the instance so we add nothing app-visible. */
interface SocketState {
  id: number;
  url: string;
  /** Metro-internal / socket.io connections: tracked but never recorded. */
  skip: boolean;
}

const socketStates = new WeakMap<WebSocketLike, SocketState>();

export function installWebSocketInspector(): () => void {
  const globalScope = globalThis as unknown as GlobalWithWebSocket;
  if (typeof globalScope.WebSocket !== 'function') {
    throw new Error('global WebSocket is unavailable on this platform');
  }

  let nextSocketId = 0;

  return patchMethod(globalScope, 'WebSocket', (Original) => {
    // Bound to a const so the subclass keeps `Original`'s statics (CONNECTING,
    // OPEN, …) and prototype chain — `instanceof WebSocket` still holds.
    const Base = Original;

    return class InspectedWebSocket extends Base {
      constructor(url: string, protocols?: unknown, options?: unknown) {
        super(url, protocols, options);

        const state: SocketState = {
          id: nextSocketId++,
          url,
          skip: isMetroInternalUrl(url) || isSocketIOUrl(url),
        };
        socketStates.set(this, state);

        safeCapture(() => {
          if (state.skip) {
            return;
          }
          recordFrame(state, 'lifecycle', 'connecting');

          this.addEventListener('open', () => {
            safeCapture(() => recordFrame(state, 'lifecycle', 'open'));
          });

          this.addEventListener('message', (event: { data?: unknown }) => {
            safeCapture(() =>
              recordFrame(state, 'receive', 'message', event?.data)
            );
          });

          this.addEventListener('close', (event: CloseData) => {
            safeCapture(() =>
              recordFrame(state, 'lifecycle', 'close', undefined, {
                code: event?.code,
                reason: event?.reason,
              })
            );
          });

          this.addEventListener('error', (event: { message?: string }) => {
            safeCapture(() =>
              recordFrame(
                state,
                'lifecycle',
                'error',
                undefined,
                undefined,
                event?.message
              )
            );
          });
        });
      }

      send(data: unknown): void {
        super.send(data);
        safeCapture(() => {
          const state = socketStates.get(this);
          if (state && !state.skip) {
            recordFrame(state, 'send', 'message', data);
          }
        });
      }
    };
  });
}

// Socket.IO connections ride Engine.IO over the global WebSocket, so they surface
// here as encoded engine.io frames (`42[...]`, heartbeats). We skip them: the
// decoded, useful view lives in the dedicated Socket.IO tab. Every engine.io URL
// carries the `EIO=` protocol-version query param (and defaults to `/socket.io/`).
function isSocketIOUrl(url: string): boolean {
  return url.includes('EIO=') || url.includes('/socket.io/');
}

function isMetroInternalUrl(url: string): boolean {
  if (
    !url.startsWith('ws://') &&
    !url.startsWith('wss://') &&
    !url.startsWith('http://') &&
    !url.startsWith('https://')
  ) {
    return true;
  }

  if (url.match(/^http:\/\/[0-9.]+:8081\/hot$/)) {
    return true;
  }

  return false;
}

function recordFrame(
  socket: SocketState,
  direction: SocketDirection,
  type: string,
  payloadData?: unknown,
  closeData?: CloseData,
  error?: string
): void {
  const session = getCurrentSession();
  if (!session) {
    return;
  }

  let payload: string | undefined;
  let payloadTruncated = false;
  if (payloadData != null) {
    const result = truncateToBytes(
      safeStringify(payloadData),
      MAX_PAYLOAD_BYTES
    );
    payload = result.text;
    payloadTruncated = result.truncated;
  }

  const event: WebSocketEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'websocket',
    connectionId: `ws-${socket.id}`,
    url: socket.url,
    direction,
    type,
    payload,
    payloadTruncated,
    closeCode: closeData?.code,
    closeReason: closeData?.reason,
    error,
  };
  captureEvent(event);
}
