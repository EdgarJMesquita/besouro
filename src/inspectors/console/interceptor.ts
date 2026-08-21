/**
 * Console capture mechanism — internal.
 *
 * Patches `console.log/info/warn/debug/error`, delegating to the originals first so
 * terminal/Metro output is unaffected.
 *
 * `installConsoleInspector` is the entry point, called by the controller.
 */

import { patchMethod, safeCapture } from '../../core/base-interceptor';
import { captureEvent, createEventId } from '../../core/capture';
import { getCurrentSession } from '../../core/session';
import { truncateToBytes } from '../../core/truncate';
import { formatArguments } from '../../core/serialize';
import { BESOURO_REGISTRY_KEY } from '../../core/besouro-registry-key';
import type { ConsoleEvent, ConsoleMethod } from '../../core/types';

const CONSOLE_METHODS: ConsoleMethod[] = [
  'log',
  'info',
  'warn',
  'debug',
  'error',
];
/** Per-line ceiling for a captured console message — 100 KB, so a stringified
 * object dump survives intact rather than being cut mid-structure. */
const MAX_MESSAGE_BYTES = 100_000;

/**
 * `AppRegistry.runApplication` logs `Running "<key>" with <json>` every time a
 * surface mounts, so opening the drawer writes a line into the console tab the
 * developer is opening it to read.
 *
 * Only the prefix is matched: the payload
 * (`{"rootTag":61,"initialProps":{},"fabric":true}`) carries a fresh rootTag per
 * mount and its shape follows RN's, so anchoring on it would make the filter
 * miss the moment either changes. The app key is ours and stable, and the line
 * is one string argument, so the prefix identifies it exactly.
 */
const BESOURO_SURFACE_LOG = `Running "${BESOURO_REGISTRY_KEY}"`;

type ConsoleMethods = Record<ConsoleMethod, (...args: unknown[]) => void>;

export function installConsoleInspector(): () => void {
  const target = (globalThis as unknown as { console: ConsoleMethods }).console;

  const restores = CONSOLE_METHODS.map((method) =>
    patchMethod(target, method, (original) => {
      return (...args: unknown[]): void => {
        original?.(...args);
        safeCapture(() => recordConsole(method, args));
      };
    })
  );

  return () => {
    for (const restore of restores) {
      restore();
    }
  };
}

function recordConsole(level: ConsoleMethod, args: unknown[]): void {
  const session = getCurrentSession();
  if (!session || isBesouroSurfaceLog(args)) {
    return;
  }
  const { text, truncated } = truncateToBytes(
    formatArguments(args),
    MAX_MESSAGE_BYTES
  );
  const event: ConsoleEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'console',
    level,
    message: text,
    messageTruncated: truncated,
  };
  captureEvent(event);
}

/** The drawer's own AppRegistry mount log — see {@link BESOURO_SURFACE_LOG}. */
function isBesouroSurfaceLog(args: unknown[]): boolean {
  return (
    args.length === 1 &&
    typeof args[0] === 'string' &&
    args[0].startsWith(BESOURO_SURFACE_LOG)
  );
}
