/**
 * Shared monkey-patch discipline (SPEC §5). Every inspector patches through here
 * so all patches are: idempotent (Fast Refresh safe), reversible (save/restore),
 * defensive (capture never breaks the host call), and status-tracked.
 */

import type { Inspector } from './types';
import { setInspectorStatus } from './status';
import { warn } from './warn';

const PATCHED = Symbol.for('besouro.patched');

type Patchable = Record<symbol, unknown>;

function isPatched(value: unknown): boolean {
  return (
    typeof value === 'function' &&
    (value as unknown as Patchable)[PATCHED] === true
  );
}

function markPatched(value: unknown): void {
  if (typeof value === 'function') {
    (value as unknown as Patchable)[PATCHED] = true;
  }
}

/**
 * Idempotently replace `target[key]` with a wrapper. Returns a restore function
 * that reverts to the original only if the slot still holds our wrapper. No-ops
 * (returning a noop restore) if the slot is already patched.
 */
export function patchMethod<Target extends object, Key extends keyof Target>(
  target: Target,
  key: Key,
  createWrapper: (original: Target[Key]) => Target[Key]
): () => void {
  const original = target[key];
  if (isPatched(original)) {
    return noop;
  }
  const wrapper = createWrapper(original);
  markPatched(wrapper);
  target[key] = wrapper;
  return () => {
    if (target[key] === wrapper) {
      target[key] = original;
    }
  };
}

/**
 * Run an inspector's install defensively. On success marks it `active` and wraps
 * the returned uninstall so teardown never throws; on failure marks it `degraded`
 * and returns a noop — the host app and other inspectors keep working.
 */
export function guardInstall(
  inspector: Inspector,
  install: () => () => void
): () => void {
  try {
    const uninstall = install();
    setInspectorStatus(inspector, 'active');
    return () => {
      try {
        uninstall();
      } catch {
        // Never throw from teardown.
      }
    };
  } catch (error) {
    setInspectorStatus(inspector, 'degraded');
    warnDegraded(inspector, error);
    return noop;
  }
}

/**
 * Surface why an inspector degraded (dev only) — silent failures are hard to debug.
 *
 * Dev-gated where the unlinked-native-module warning (`core/controller`) is not:
 * a degraded inspector leaves the rest of the tool working, so in a build that
 * deliberately ships the devtools this is noise the host app's users would see.
 */
function warnDegraded(inspector: Inspector, error: unknown): void {
  const isDev = (globalThis as { __DEV__?: boolean }).__DEV__ !== false;
  if (!isDev) {
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  warn(`"${inspector}" inspector degraded: ${message}`);
}

/**
 * Record an event defensively. A capture/serialization failure is swallowed so it
 * can never reach the intercepted host call.
 */
export function safeCapture(capture: () => void): void {
  try {
    capture();
  } catch {
    // Swallowed by design (§5): instrumentation must not break the host.
  }
}

function noop(): void {}
