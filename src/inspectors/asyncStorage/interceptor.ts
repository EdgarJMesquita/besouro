/**
 * AsyncStorage capture mechanism — internal.
 *
 * Patches the AsyncStorage singleton's methods (delegating to the originals first),
 * ignoring the library's own key namespace to avoid recursion. The module is passed
 * in by the consumer (Metro cannot safely auto-require an optional peer — §4.1).
 *
 * `installAsyncStorageInspector` is the entry point, called by the controller when
 * the consumer supplies the module via `asyncStorage`.
 */

import { patchMethod, safeCapture } from '../../core/base-interceptor';
import { captureEvent, createEventId } from '../../core/capture';
import { getCurrentSession } from '../../core/session';
import { truncateToBytes } from '../../core/truncate';
import { safeStringify } from '../../core/serialize';
import type {
  AsyncStorageEvent,
  StorageDirection,
  StorageOperation,
} from '../../core/types';
import type { AsyncStorageLike } from './types';

/** Per-entry ceiling for a captured value — 500 KB. */
const MAX_VALUE_BYTES = 500_000;

export function installAsyncStorageInspector(
  asyncStorage: AsyncStorageLike
): () => void {
  const restores: Array<() => void> = [];

  restores.push(
    patchMethod(asyncStorage, 'getItem', (original) => {
      const call = original as AsyncStorageLike['getItem'];
      return (key: string) =>
        track(
          'getItem',
          [key],
          'read',
          (result) => result ?? undefined,
          () => call(key)
        );
    })
  );

  restores.push(
    patchMethod(asyncStorage, 'setItem', (original) => {
      const call = original as AsyncStorageLike['setItem'];
      return (key: string, value: string) =>
        track(
          'setItem',
          [key],
          'write',
          () => value,
          () => call(key, value)
        );
    })
  );

  restores.push(
    patchMethod(asyncStorage, 'removeItem', (original) => {
      const call = original as AsyncStorageLike['removeItem'];
      return (key: string) =>
        track(
          'removeItem',
          [key],
          'delete',
          () => undefined,
          () => call(key)
        );
    })
  );

  restores.push(
    patchMethod(asyncStorage, 'clear', (original) => {
      const call = original as AsyncStorageLike['clear'];
      return () =>
        track(
          'clear',
          [],
          'delete',
          () => undefined,
          () => call()
        );
    })
  );

  restores.push(
    patchMethod(asyncStorage, 'getAllKeys', (original) => {
      const call = original as AsyncStorageLike['getAllKeys'];
      return () =>
        track(
          'getAllKeys',
          [],
          'read',
          (keys) => safeStringify(keys),
          () => call()
        );
    })
  );

  if (asyncStorage.multiGet) {
    restores.push(
      patchMethod(asyncStorage, 'multiGet', (original) => {
        const call = original as NonNullable<AsyncStorageLike['multiGet']>;
        return (keys: readonly string[]) =>
          track(
            'multiGet',
            [...keys],
            'read',
            (pairs) => safeStringify(pairs),
            () => call(keys)
          );
      })
    );
  }

  if (asyncStorage.multiSet) {
    restores.push(
      patchMethod(asyncStorage, 'multiSet', (original) => {
        const call = original as NonNullable<AsyncStorageLike['multiSet']>;
        return (pairs: readonly (readonly [string, string])[]) =>
          track(
            'multiSet',
            pairs.map((pair) => pair[0]),
            'write',
            () => safeStringify(pairs),
            () => call(pairs)
          );
      })
    );
  }

  if (asyncStorage.multiRemove) {
    restores.push(
      patchMethod(asyncStorage, 'multiRemove', (original) => {
        const call = original as NonNullable<AsyncStorageLike['multiRemove']>;
        return (keys: readonly string[]) =>
          track(
            'multiRemove',
            [...keys],
            'delete',
            () => undefined,
            () => call(keys)
          );
      })
    );
  }

  return () => {
    for (const restore of restores) {
      restore();
    }
  };
}

/**
 * Time an AsyncStorage call and record an event on completion. Always delegates to
 * the underlying call and preserves its resolve/reject.
 */
function track<Result>(
  operation: StorageOperation,
  keys: string[],
  direction: StorageDirection,
  resolveValue: (result: Result) => string | undefined,
  call: () => Promise<Result>
): Promise<Result> {
  const startTime = Date.now();
  return call().then(
    (result) => {
      safeCapture(() =>
        record(
          operation,
          keys,
          direction,
          resolveValue(result),
          Date.now() - startTime
        )
      );
      return result;
    },
    (error: unknown) => {
      safeCapture(() =>
        record(
          operation,
          keys,
          direction,
          undefined,
          Date.now() - startTime,
          errorMessage(error)
        )
      );
      throw error;
    }
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : safeStringify(error);
}

function record(
  operation: StorageOperation,
  keys: string[],
  direction: StorageDirection,
  value: string | undefined,
  durationMs: number,
  error?: string
): void {
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  let capturedValue: string | undefined;
  let valueTruncated = false;
  if (value != null) {
    const result = truncateToBytes(value, MAX_VALUE_BYTES);
    capturedValue = result.text;
    valueTruncated = result.truncated;
  }
  const event: AsyncStorageEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'asyncStorage',
    operation,
    keys,
    value: capturedValue,
    valueTruncated,
    direction,
    durationMs,
    error,
  };
  captureEvent(event);
}
