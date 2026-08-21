/**
 * Observable device-token registry. The Notifications inspector publishes the
 * current push token(s) here as they resolve or refresh; the Notifications tab's
 * "Device Token" drawer subscribes to display and copy them.
 *
 * A sibling of the inspector's entry point rather than part of it: the tab imports
 * this module directly, so reading tokens never pulls the interceptor — or the
 * optional peer modules it wraps — into the drawer bundle.
 */

import { useSyncExternalStore } from 'react';
import type { NotificationProvider } from '../../../core/types';

export interface DeviceToken {
  provider: NotificationProvider;
  /** Token flavor: 'expo' | 'fcm' | 'apns' | 'device'. */
  kind: string;
  token: string;
  updatedAt: number;
  /**
   * Set when the token could not be resolved (e.g. push not configured yet).
   * Carries a human-readable hint; `token` is empty in this case.
   */
  error?: string;
}

const tokensByKey = new Map<string, DeviceToken>();
const listeners = new Set<() => void>();
let snapshot: DeviceToken[] = [];

function tokenKey(provider: string, kind: string): string {
  return `${provider}:${kind}`;
}

/** Publish or refresh a device token. No-ops when the token is unchanged. */
export function setDeviceToken(token: DeviceToken): void {
  const key = tokenKey(token.provider, token.kind);
  const existing = tokensByKey.get(key);
  if (
    existing &&
    existing.token === token.token &&
    existing.error === token.error
  ) {
    return;
  }
  tokensByKey.set(key, token);
  snapshot = [...tokensByKey.values()];
  for (const listener of listeners) {
    listener();
  }
}

export function getDeviceTokens(): DeviceToken[] {
  return snapshot;
}

export function subscribeDeviceTokens(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Clear all tokens — used when the notifications inspector tears down. */
export function clearDeviceTokens(): void {
  if (tokensByKey.size === 0) {
    return;
  }
  tokensByKey.clear();
  snapshot = [];
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribe a component to the current device tokens. */
export function useDeviceTokens(): DeviceToken[] {
  return useSyncExternalStore(subscribeDeviceTokens, getDeviceTokens);
}
