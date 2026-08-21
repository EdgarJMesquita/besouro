import { describe, it, expect, jest, afterEach } from '@jest/globals';
import {
  setDeviceToken,
  getDeviceTokens,
  subscribeDeviceTokens,
  clearDeviceTokens,
} from '../device-tokens';

afterEach(() => {
  clearDeviceTokens();
});

describe('device-tokens', () => {
  it('stores tokens keyed by provider and kind', () => {
    setDeviceToken({
      provider: 'expo',
      kind: 'expo',
      token: 'A',
      updatedAt: 1,
    });
    setDeviceToken({
      provider: 'firebase',
      kind: 'fcm',
      token: 'B',
      updatedAt: 1,
    });
    expect(getDeviceTokens()).toHaveLength(2);
  });

  it('replaces a token of the same provider/kind', () => {
    setDeviceToken({
      provider: 'expo',
      kind: 'expo',
      token: 'A',
      updatedAt: 1,
    });
    setDeviceToken({
      provider: 'expo',
      kind: 'expo',
      token: 'B',
      updatedAt: 2,
    });
    const tokens = getDeviceTokens();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.token).toBe('B');
  });

  it('does not notify when an identical token is re-set', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeDeviceTokens(listener);
    setDeviceToken({
      provider: 'expo',
      kind: 'expo',
      token: 'A',
      updatedAt: 1,
    });
    setDeviceToken({
      provider: 'expo',
      kind: 'expo',
      token: 'A',
      updatedAt: 2,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('clears all tokens', () => {
    setDeviceToken({
      provider: 'expo',
      kind: 'expo',
      token: 'A',
      updatedAt: 1,
    });
    clearDeviceTokens();
    expect(getDeviceTokens()).toEqual([]);
  });
});
