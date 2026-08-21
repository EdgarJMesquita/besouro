/**
 * Pure byte-size formatting, kept free of React Native imports so it can be
 * unit-tested in the node test environment (see jest.config.js), mirroring
 * duration-format.ts. Shared by the File System and Network inspectors.
 */

/** Human-readable byte size (e.g. "1.4 KB"). Returns "—" when unknown. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes == null || bytes < 0) {
    return '—';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  // One decimal below 10 (e.g. "1.4 KB"), none above (e.g. "23 MB").
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}
