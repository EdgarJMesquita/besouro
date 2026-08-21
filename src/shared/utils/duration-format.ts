/**
 * Pure duration formatting, kept free of React Native imports so it can be
 * unit-tested in the node test environment (see jest.config.js), mirroring
 * network-format.ts. Re-exported from shared.tsx for inspector consumers.
 */

/**
 * Human-readable duration: `300ms` below a second, `44s` / `44.06s` (up to two
 * decimals) below a minute, and `1.7min` (one decimal) above. Trailing zeros
 * are trimmed. Returns `—` for a nullish duration.
 */
export function formatDuration(durationMs: number | undefined): string {
  if (durationMs == null) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  const totalSeconds = durationMs / 1000;
  if (totalSeconds < 60) {
    // Up to 2 decimals, with trailing zeros trimmed (e.g. `44s`, `44.06s`).
    return `${Number(totalSeconds.toFixed(2))}s`;
  }
  // Minutes as a single-decimal value (e.g. `1.7min`), trailing `.0` trimmed.
  return `${Number((totalSeconds / 60).toFixed(1))}min`;
}
