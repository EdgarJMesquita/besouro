/**
 * The fallback the Zustand and Jotai state panes use when a store has no rows —
 * after the log is cleared, or when its initial capture threw.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

import {
  clearLiveState,
  readLiveState,
  registerLiveState,
} from '../live-state';

describe('core/live-state', () => {
  beforeEach(() => {
    clearLiveState();
  });

  it('serializes what the store holds at the moment it is read', () => {
    let state = { count: 0 };
    registerLiveState('zustand-1', () => state);

    // Read on every call, never remembered: a copy taken at registration is the
    // drift this exists to avoid.
    expect(readLiveState('zustand-1')?.raw).toBe('{"count":0}');
    state = { count: 7 };
    expect(readLiveState('zustand-1')?.raw).toBe('{"count":7}');
  });

  it('knows nothing about a store that was never registered', () => {
    expect(readLiveState('zustand-9')).toBeNull();
  });

  it('stops answering once the store is released', () => {
    const release = registerLiveState('jotai-1', () => 5);
    expect(readLiveState('jotai-1')?.raw).toBe('5');

    release();

    // Detached: the inspector is no longer watching, so the pane says "no value"
    // rather than reporting a store nothing is following.
    expect(readLiveState('jotai-1')).toBeNull();
  });

  it('releases only its own reader, not a later one under the same id', () => {
    // A re-install inherits the previous store's id (see the interceptors' watch
    // symbol); the retired attach must not take the live one down with it.
    const release = registerLiveState('zustand-1', () => 'old');
    registerLiveState('zustand-1', () => 'new');

    release();

    // A bare string, not a quoted one — `safeStringify` passes strings through.
    expect(readLiveState('zustand-1')?.raw).toBe('new');
  });

  it('says nothing rather than throwing when the store’s getter fails', () => {
    registerLiveState('zustand-2', () => {
      throw new Error('nope');
    });

    expect(readLiveState('zustand-2')).toBeNull();
  });

  it('reports a value clipped at the ceiling as truncated', () => {
    registerLiveState('zustand-3', () => 'x'.repeat(600_000));

    const live = readLiveState('zustand-3');
    expect(live?.truncated).toBe(true);
    expect(live?.raw.length).toBeLessThan(600_000);
  });
});
