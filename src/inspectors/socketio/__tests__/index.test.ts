/**
 * Socket.IO inspector — hand-rolled fakes reproduce the structural contract we
 * depend on: a `Socket` exposing socket.io's official hooks (`onAny` /
 * `onAnyOutgoing` / `on`) with test drivers to simulate traffic, and a `Manager`
 * whose `prototype.socket` factory the inspector patches. No dependency on the
 * real socket.io-client package.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import { installSocketIOInspector } from '../interceptor';
import type { SocketIOClientLike, SocketIOManagerLike } from '../types';
import { recordCaptures } from '../../../core/__tests__/capture-recorder';
import { startSession } from '../../../core/session';
import type { SocketIOEvent } from '../../../core/types';

type AnyListener = (event: string, ...args: unknown[]) => void;
type NamedListener = (...args: unknown[]) => void;

/** Structural stand-in for a socket.io-client `Socket`, plus `_`-prefixed drivers. */
class FakeSocket {
  nsp: string;
  io: { uri?: string }; // the Manager ref the inspector reads `.uri` from
  private anyListeners = new Set<AnyListener>();
  private anyOutgoing = new Set<AnyListener>();
  private named = new Map<string, Set<NamedListener>>();

  constructor(nsp: string, uri?: string) {
    this.nsp = nsp;
    this.io = { uri };
  }

  emit(): unknown {
    return this;
  }
  onAny(fn: AnyListener): unknown {
    this.anyListeners.add(fn);
    return this;
  }
  offAny(fn: AnyListener): unknown {
    this.anyListeners.delete(fn);
    return this;
  }
  onAnyOutgoing(fn: AnyListener): unknown {
    this.anyOutgoing.add(fn);
    return this;
  }
  offAnyOutgoing(fn: AnyListener): unknown {
    this.anyOutgoing.delete(fn);
    return this;
  }
  on(event: string, fn: NamedListener): unknown {
    let set = this.named.get(event);
    if (!set) {
      set = new Set();
      this.named.set(event, set);
    }
    set.add(fn);
    return this;
  }
  off(event: string, fn: NamedListener): unknown {
    this.named.get(event)?.delete(fn);
    return this;
  }

  // Test drivers — simulate the three inbound paths the inspector hooks.
  _receive(event: string, ...args: unknown[]): void {
    for (const l of [...this.anyListeners]) l(event, ...args);
  }
  _send(event: string, ...args: unknown[]): void {
    for (const l of [...this.anyOutgoing]) l(event, ...args);
  }
  _lifecycle(name: string, ...args: unknown[]): void {
    for (const l of [...(this.named.get(name) ?? [])]) l(...args);
  }
}

/** Fresh Manager class per test so prototype patches never bleed across cases. */
const MANAGER_URI = 'wss://sockets.test';

/** Records what capture hands to persistence — see capture-recorder. */
const captured = recordCaptures();

function makeManagerClass() {
  return class FakeManager {
    private nsps: Record<string, FakeSocket> = {};
    // Mirrors Manager.prototype.socket: one cached Socket per namespace.
    socket(nsp: string): SocketIOClientLike {
      let socket = this.nsps[nsp];
      if (!socket) {
        socket = new FakeSocket(nsp, MANAGER_URI);
        this.nsps[nsp] = socket;
      }
      return socket as unknown as SocketIOClientLike;
    }
  };
}

function asManager(cls: unknown): SocketIOManagerLike {
  return cls as SocketIOManagerLike;
}

function socketEvents(): SocketIOEvent[] {
  return captured.eventsOf<SocketIOEvent>('socketio');
}

describe('installSocketIOInspector auto-intercept', () => {
  beforeEach(() => {
    captured.reset();
    startSession();
  });

  it('captures send / receive / lifecycle for sockets created after install', () => {
    const Manager = makeManagerClass();
    const teardown = installSocketIOInspector({
      Manager: asManager(Manager),
    });

    const socket = new Manager().socket('/chat') as unknown as FakeSocket;
    socket._lifecycle('connect');
    socket._send('ping', { a: 1 });
    socket._receive('pong', { b: 2 });

    const seen = socketEvents().map((e) => [e.direction, e.event]);
    expect(seen).toEqual(
      expect.arrayContaining([
        ['lifecycle', 'connect'],
        ['send', 'ping'],
        ['receive', 'pong'],
      ])
    );
    expect(socketEvents().every((e) => e.namespace === '/chat')).toBe(true);
    expect(socketEvents().every((e) => e.url === 'wss://sockets.test')).toBe(
      true
    );

    teardown();
  });

  it('does not double-instrument a cached socket or across duplicate installs', () => {
    const Manager = makeManagerClass();
    const t1 = installSocketIOInspector({ Manager: asManager(Manager) });
    const t2 = installSocketIOInspector({ Manager: asManager(Manager) });

    const manager = new Manager();
    const first = manager.socket('/') as unknown as FakeSocket;
    const cached = manager.socket('/') as unknown as FakeSocket;
    expect(cached).toBe(first);

    first._receive('hello', {});
    expect(socketEvents().filter((e) => e.event === 'hello')).toHaveLength(1);

    t1();
    t2();
  });

  it('stops instrumenting new sockets after teardown', () => {
    const Manager = makeManagerClass();
    const teardown = installSocketIOInspector({
      Manager: asManager(Manager),
    });
    teardown();

    const socket = new Manager().socket('/') as unknown as FakeSocket;
    socket._receive('hi', {});
    expect(socketEvents()).toHaveLength(0);
  });

  it('flags an inbound event carrying an ack responder', () => {
    const Manager = makeManagerClass();
    const teardown = installSocketIOInspector({
      Manager: asManager(Manager),
    });

    const socket = new Manager().socket('/') as unknown as FakeSocket;
    socket._receive('need-ack', { x: 1 }, () => {});

    const record = socketEvents().find((e) => e.event === 'need-ack');
    expect(record?.direction).toBe('receive');
    expect(record?.hasAck).toBe(true);

    teardown();
  });

  it('install is a safe no-op when no Manager is injected', () => {
    const teardown = installSocketIOInspector({});
    expect(typeof teardown).toBe('function');
    expect(() => teardown()).not.toThrow();
    expect(socketEvents()).toHaveLength(0);
  });
});
