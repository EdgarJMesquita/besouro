/**
 * Socket.IO capture mechanism — internal.
 *
 * Socket.IO rides on Engine.IO in an encoded, transport-varying form, so we attach
 * at the client API level instead of the wire: pass the `Manager` class from
 * socket.io-client into `socketioInspector({ Manager })` and we patch
 * `Manager.prototype.socket` — the factory every `io()` call routes through — so
 * every socket created anywhere in the app is instrumented with no per-socket wiring
 * in feature code. The class is injected (not imported) so the library never bundles
 * socket.io.
 *
 * There is deliberately no per-socket attach export. Instrumenting one instance
 * would mean calling into this subpath from feature code, and that plants a static
 * `besouro` import in a module that ships in release — defeating
 * the consumer's single dev-only `require` (§11). Injecting `Manager` in the config
 * keeps the entire graph on the dev side of that boundary, and covers every socket
 * created after install.
 *
 * Capture uses socket.io's official hooks only — `onAnyOutgoing` (send), `onAny`
 * (receive), and `on(...)` for lifecycle — so we never reassign `emit`/`off`.
 */

import { safeCapture } from '../../core/base-interceptor';
import { captureEvent, createEventId } from '../../core/capture';
import { getCurrentSession } from '../../core/session';
import { truncateToBytes } from '../../core/truncate';
import { formatArguments } from '../../core/serialize';
import type { SocketDirection, SocketIOEvent } from '../../core/types';
import type {
  SocketIOClientLike,
  SocketIOInspectorOptions,
  SocketIOManagerLike,
} from './types';

/** Per-frame ceiling for a captured argument list — 500 KB. */
const MAX_ARGS_BYTES = 500_000;

const LIFECYCLE_EVENTS = [
  'connect',
  'disconnect',
  'connect_error',
  'reconnect',
  'reconnect_attempt',
  'reconnect_error',
  'reconnect_failed',
];

// Marks a patched `Manager.prototype` so repeated installs / hot reloads don't
// stack wrappers, and a patched socket so auto + manual attach never double-log.
const MANAGER_PATCHED = '__besouroManagerPatched';
const SOCKET_PATCHED = '__besouroSocketPatched';

export function installSocketIOInspector(
  options: SocketIOInspectorOptions
): () => void {
  const { Manager } = options;
  // No Manager injected (or an unexpected shape on a future socket.io version):
  // the tab still renders; users can fall back to attachSocketIO(socket).
  if (!Manager || typeof Manager.prototype?.socket !== 'function') {
    return () => {};
  }

  const proto = Manager.prototype as SocketIOManagerLike['prototype'] &
    Record<string, unknown>;
  if (proto[MANAGER_PATCHED]) {
    return () => {};
  }

  const originalSocket = proto.socket;
  proto.socket = function patchedSocket(
    this: unknown,
    nsp: string,
    opts?: unknown
  ): SocketIOClientLike {
    const socket = originalSocket.call(this, nsp, opts);
    safeCapture(() => patchSocket(socket));
    return socket;
  };
  proto[MANAGER_PATCHED] = true;

  return () => {
    proto.socket = originalSocket;
    delete proto[MANAGER_PATCHED];
  };
}

let attachCount = 0;

/**
 * Instrument one socket. Idempotent: the Manager caches one socket per namespace, so
 * the patched factory can hand us the same instance more than once.
 *
 * Listeners are not torn down per socket. Uninstall restores `Manager.prototype`, so
 * no *new* socket is instrumented, but an already-live socket keeps its listeners
 * for as long as it exists — matching the socket's own lifetime rather than the
 * inspector's.
 */
function patchSocket(socket: SocketIOClientLike): void {
  const flagged = socket as SocketIOClientLike & Record<string, unknown>;
  if (flagged[SOCKET_PATCHED]) {
    return;
  }
  flagged[SOCKET_PATCHED] = true;

  attachCount += 1;
  const clientId = `sio-${attachCount}`;
  // `nsp` and `io.uri` are read at runtime (a private field and the public Manager
  // ref) rather than declared on SocketIOClientLike, keeping a real Socket
  // assignable without a cast.
  const nsp = (socket as { nsp?: unknown }).nsp;
  const namespace = typeof nsp === 'string' ? nsp : '/';
  const uri = (socket as { io?: { uri?: unknown } }).io?.uri;
  const url = typeof uri === 'string' ? uri : undefined;

  const anyListener = (event: string, ...args: unknown[]): void => {
    safeCapture(() =>
      recordEvent(clientId, namespace, url, 'receive', event, args)
    );
  };
  socket.onAny?.(anyListener);

  const outgoingListener = (event: string, ...args: unknown[]): void => {
    safeCapture(() =>
      recordEvent(clientId, namespace, url, 'send', event, args)
    );
  };
  socket.onAnyOutgoing?.(outgoingListener);

  for (const name of LIFECYCLE_EVENTS) {
    socket.on(name, (...args: unknown[]): void => {
      safeCapture(() =>
        recordEvent(clientId, namespace, url, 'lifecycle', name, args)
      );
    });
  }
}

function recordEvent(
  clientId: string,
  namespace: string,
  url: string | undefined,
  direction: SocketDirection,
  event: string,
  args: unknown[]
): void {
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  // An inbound event whose trailing arg is a function carries a client-side ack
  // responder. (Outbound acks are stripped by socket.io before onAnyOutgoing, so
  // this is only ever true for received events — which is the useful signal.)
  const hasAck = args.length > 0 && typeof args[args.length - 1] === 'function';
  const { text, truncated } = truncateToBytes(
    formatArguments(args),
    MAX_ARGS_BYTES
  );
  const socketEvent: SocketIOEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'socketio',
    clientId,
    namespace,
    url,
    direction,
    event,
    args: text,
    argsTruncated: truncated,
    hasAck,
  };
  captureEvent(socketEvent);
}
