/**
 * What the action log's subtitle says — and, as often, what it declines to say.
 */

import { describe, it, expect } from '@jest/globals';
import { actionSummary } from '../utils/action-summary';
import type { ReduxEvent } from '../../../core/types';

const NO_CHANGE = 'No state change';

function event(overrides: Partial<ReduxEvent> = {}): ReduxEvent {
  return {
    id: 'e1',
    sessionId: 's1',
    timestamp: 1,
    kind: 'redux',
    actionType: 'counter/increment',
    isInitial: false,
    isReload: false,
    isFinal: false,
    changedKeys: ['counter'],
    changedPaths: ['counter.value'],
    payloadTruncated: false,
    changedStateTruncated: false,
    stateIsFull: false,
    ...overrides,
  };
}

describe('actionSummary', () => {
  it('lists the nested paths that changed', () => {
    expect(actionSummary(event(), NO_CHANGE)).toBe('counter.value');
  });

  it('says nothing when the only path repeats the action type', () => {
    // `counter/increment` changing `counter` tells the reader what they just read.
    expect(
      actionSummary(
        event({ changedPaths: ['counter'], changedKeys: ['counter'] }),
        NO_CHANGE
      )
    ).toBe('');
  });

  it('speaks up when an action reaches outside its own slice', () => {
    // The signal worth surfacing: why did `auth/login` touch `cart`?
    expect(
      actionSummary(
        event({
          actionType: 'auth/login',
          changedKeys: ['auth', 'cart'],
          changedPaths: ['auth.user', 'cart.items'],
        }),
        NO_CHANGE
      )
    ).toBe('auth.user, cart.items');
  });

  it('keeps the caption for a type with no slice prefix', () => {
    expect(
      actionSummary(
        event({ actionType: 'ADD_TODO', changedPaths: ['todos'] }),
        NO_CHANGE
      )
    ).toBe('todos');
  });

  it('reports an action that moved nothing', () => {
    expect(
      actionSummary(event({ changedKeys: [], changedPaths: [] }), NO_CHANGE)
    ).toBe(NO_CHANGE);
  });

  it('lists what an initial row carries, like any other row', () => {
    // The initial marker is the badge's job (`shared/components/BaselinePill`), so
    // the caption keeps meaning "what this row changed" on every row.
    expect(
      actionSummary(
        event({
          isInitial: true,
          actionType: '@@redux/REPLACE',
          changedKeys: ['auth', 'cart'],
          changedPaths: [],
        }),
        NO_CHANGE
      )
    ).toBe('auth, cart');
  });

  it('falls back to the slices when no paths were recorded', () => {
    expect(
      actionSummary(
        event({ actionType: 'x/y', changedKeys: ['cart'], changedPaths: [] }),
        NO_CHANGE
      )
    ).toBe('cart');
  });
});
