/**
 * Capture holds no events — it hands them to the write queue. These tests cover
 * exactly that: the hand-off, the kind routing that `patchEvent` needs, and the
 * drop-on-no-sink behaviour that stands in for a memory fallback.
 */

import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { captureEvent, patchEvent, setEventSink } from '../record';
import type { ConsoleEvent, NetworkEvent } from '../../types';
import type { EventQueue } from '../queue';

let counter = 0;

function consoleEvent(): ConsoleEvent {
  counter += 1;
  return {
    id: `c-${counter}`,
    sessionId: 's',
    timestamp: counter,
    kind: 'console',
    level: 'log',
    message: `line ${counter}`,
    messageTruncated: false,
  };
}

function networkEvent(): NetworkEvent {
  counter += 1;
  return {
    id: `n-${counter}`,
    sessionId: 's',
    timestamp: counter,
    kind: 'network',
    method: 'GET',
    url: `https://example.com/${counter}`,
    requestHeaders: {},
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    phase: 'pending',
  };
}

function fakeQueue() {
  return {
    add: jest.fn(),
    update: jest.fn(),
    flush: jest.fn(),
    disable: jest.fn(),
    isEnabled: () => true,
    pendingCount: () => 0,
  };
}

/** Attach a fake queue as the sink. The sink is module state, so tests detach it. */
function withSink() {
  const queue = fakeQueue();
  setEventSink(queue as unknown as EventQueue);
  return queue;
}

afterEach(() => {
  setEventSink(null);
});

describe('hand-off to the write queue', () => {
  it('forwards captured events without retaining them', () => {
    const queue = withSink();
    const event = consoleEvent();

    captureEvent(event);

    expect(queue.add).toHaveBeenCalledWith(event);
  });

  it('routes a patch to the right table using the caller-supplied kind', () => {
    const queue = withSink();
    const event = networkEvent();
    captureEvent(event);

    patchEvent(event.id, 'network', { status: 200, phase: 'success' });

    expect(queue.update).toHaveBeenCalledWith(
      event.id,
      'network',
      expect.objectContaining({ status: 200 })
    );
  });

  it('routes a patch for an id it never saw captured', () => {
    // Regression: kind used to be inferred from an id→kind map released on every
    // flush, so a request that outlived one flush lost its completion patch and
    // stayed "Pending" forever. Most requests outlive one flush. Keeping no
    // per-event state at all is what makes that bug inexpressible.
    const queue = withSink();

    patchEvent('unseen', 'network', { status: 500 });

    expect(queue.update).toHaveBeenCalledWith(
      'unseen',
      'network',
      expect.objectContaining({ status: 500 })
    );
  });
});

describe('with no sink attached', () => {
  it('drops captures instead of throwing', () => {
    // The database never opened (native module unlinked) — capture is a no-op,
    // not a crash, and deliberately not a memory fallback.
    setEventSink(null);

    expect(() => captureEvent(consoleEvent())).not.toThrow();
    expect(() => patchEvent('n-1', 'network', { status: 200 })).not.toThrow();
  });
});
