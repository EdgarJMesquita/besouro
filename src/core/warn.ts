/**
 * The library's one channel for talking to the developer through the console.
 *
 * Everything else the library does is silent by design — capture must never
 * intrude on the host app's own logging. These warnings are the exception:
 * they fire only when besouro itself is broken, and a devtool that fails
 * without saying so costs more than the line of output.
 *
 * `console` is reached through `globalThis` rather than the module scope
 * because the console inspector patches `console.warn` in place, and because a
 * runtime without a console at all (some JSC/Hermes embeddings) must not turn a
 * diagnostic into a crash. Callers decide *whether* to warn — the `__DEV__` gate
 * on inspector degradation lives at its own call site, since not every warning
 * wants it.
 */

/** Write one `[besouro]`-prefixed warning. Never throws. */
export function warn(message: string): void {
  const consoleWarn = (
    globalThis as { console?: { warn?: (...args: unknown[]) => void } }
  ).console?.warn;
  consoleWarn?.(`[besouro] ${message}`);
}
