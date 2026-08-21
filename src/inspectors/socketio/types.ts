/**
 * Socket.IO inspector types — internal.
 *
 * Structural stand-ins for the socket.io-client shapes the inspector touches. They
 * exist so the library never imports (or bundles) socket.io-client: a consumer
 * passes their real `Manager` to `socketio` and structural typing does
 * the rest.
 */

/**
 * Structural subset of a socket.io-client instance we rely on. Only the hooks the
 * inspector actually uses are listed (no `emit`) so a real `Socket` — whose
 * `emit` is generically typed — is assignable without a cast.
 */
export interface SocketIOClientLike {
  on: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  onAny?: (listener: (event: string, ...args: unknown[]) => void) => unknown;
  offAny?: (listener: (event: string, ...args: unknown[]) => void) => unknown;
  onAnyOutgoing?: (
    listener: (event: string, ...args: unknown[]) => void
  ) => unknown;
  offAnyOutgoing?: (
    listener: (event: string, ...args: unknown[]) => void
  ) => unknown;
  // `nsp` is intentionally omitted: it's a *private* field on the real Socket, so
  // declaring it publicly would break structural assignability. Read at runtime.
}

/** Structural subset of socket.io-client's `Manager` class we patch. */
export interface SocketIOManagerLike {
  prototype: {
    socket(nsp: string, opts?: unknown): SocketIOClientLike;
  };
}

export interface SocketIOInspectorOptions {
  /**
   * The `Manager` class from `socket.io-client`, as supplied to
   * `socketio`. Every socket the app creates through it is captured
   * automatically. Injected rather than imported so the library never depends on or
   * bundles socket.io-client.
   */
  Manager?: SocketIOManagerLike;
}
