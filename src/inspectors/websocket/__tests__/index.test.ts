/**
 * WebSocket inspector — a hand-rolled `WebSocket` stand-in installed as the global
 * reproduces the structural contract the interceptor wraps: constructor, `send`,
 * and `addEventListener` lifecycle/message events, with `_`-prefixed drivers to
 * simulate the socket answering. No real sockets, no RN internals.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { installWebSocketInspector } from '../interceptor';
import { recordCaptures } from '../../../core/__tests__/capture-recorder';
import { startSession } from '../../../core/session';
import type { WebSocketEvent } from '../../../core/types';

type Listener = (event: unknown) => void;

/** Structural stand-in for the global `WebSocket`, plus test drivers. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;

  url: string;
  sent: unknown[] = [];
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  // Test driver — dispatch what the real socket would.
  _emit(type: string, event?: unknown): void {
    for (const l of [...(this.listeners.get(type) ?? [])]) l(event);
  }
}

const globalScope = globalThis as unknown as { WebSocket: unknown };
let originalWebSocket: unknown;

/** Captured frames oldest-first — the order they were produced. */
/** Records what capture hands to persistence — see capture-recorder. */
const captured = recordCaptures();

function wsEvents(): WebSocketEvent[] {
  // Oldest first — the order the socket produced them.
  return captured.eventsOf<WebSocketEvent>('websocket');
}

/** Construct through the global so the installed wrapper is what runs. */
function connect(url: string): FakeWebSocket {
  const Ctor = globalScope.WebSocket as new (url: string) => FakeWebSocket;
  return new Ctor(url);
}

describe('installWebSocketInspector', () => {
  beforeEach(() => {
    captured.reset();
    startSession();
    originalWebSocket = globalScope.WebSocket;
    globalScope.WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    globalScope.WebSocket = originalWebSocket;
  });

  it('captures connect / open / send / receive / close for sockets created after install', () => {
    const teardown = installWebSocketInspector();

    const socket = connect('wss://chat.test/room');
    socket._emit('open');
    socket.send('ping');
    socket._emit('message', { data: 'pong' });
    socket._emit('close', { code: 1000, reason: 'bye' });

    expect(wsEvents().map((e) => [e.direction, e.type])).toEqual([
      ['lifecycle', 'connecting'],
      ['lifecycle', 'open'],
      ['send', 'message'],
      ['receive', 'message'],
      ['lifecycle', 'close'],
    ]);

    const [connecting, , sent, received, closed] = wsEvents();
    expect(connecting?.url).toBe('wss://chat.test/room');
    expect(sent?.payload).toBe('ping');
    expect(received?.payload).toBe('pong');
    expect(closed?.closeCode).toBe(1000);
    expect(closed?.closeReason).toBe('bye');

    teardown();
  });

  it('forwards send to the real socket and records the error message', () => {
    const teardown = installWebSocketInspector();

    const socket = connect('wss://chat.test/room');
    socket.send('payload');
    socket._emit('error', { message: 'boom' });

    // Instrumentation must never swallow the host call.
    expect(socket.sent).toEqual(['payload']);
    expect(wsEvents().at(-1)?.error).toBe('boom');

    teardown();
  });

  it('groups frames per connection and keeps connections distinct', () => {
    const teardown = installWebSocketInspector();

    const a = connect('wss://a.test');
    const b = connect('wss://b.test');
    a.send('from-a');
    b.send('from-b');

    const byUrl = new Map(wsEvents().map((e) => [e.url, e.connectionId]));
    expect(byUrl.get('wss://a.test')).not.toBe(byUrl.get('wss://b.test'));
    expect(
      wsEvents().filter((e) => e.connectionId === byUrl.get('wss://a.test'))
    ).toHaveLength(2); // connecting + send

    teardown();
  });

  it('skips socket.io and Metro-internal connections', () => {
    const teardown = installWebSocketInspector();

    const engineio = connect(
      'wss://api.test/socket.io/?EIO=4&transport=websocket'
    );
    engineio._emit('open');
    engineio.send('42["msg"]');
    connect('/hot')._emit('open');

    expect(wsEvents()).toHaveLength(0);
    // The host call still goes through for skipped sockets.
    expect(engineio.sent).toEqual(['42["msg"]']);

    teardown();
  });

  it('restores the original constructor on teardown and does not double-patch', () => {
    const t1 = installWebSocketInspector();
    const patched = globalScope.WebSocket;
    const t2 = installWebSocketInspector();

    // Second install is a no-op (the slot is already ours), so one wrapper only.
    expect(globalScope.WebSocket).toBe(patched);

    connect('wss://chat.test').send('once');
    expect(wsEvents().filter((e) => e.direction === 'send')).toHaveLength(1);

    t2();
    t1();
    expect(globalScope.WebSocket).toBe(FakeWebSocket);
  });
});
