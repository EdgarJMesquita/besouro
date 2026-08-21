/**
 * Pure helpers for the File System inspector: extension-based preview
 * classification and value formatting. Kept free of React/RN imports so they're
 * trivially unit-testable. Extension parsing and MIME lookup live in
 * `shared/utils/mime-types` — the share bridge needs them too.
 */

import { extensionOf } from '../../../shared/utils/mime-types';

/** How the file-detail view should render a file. */
export type FilePreviewKind = 'image' | 'text' | 'binary';

/** Extensions RN's <Image> renders directly from a file:// uri. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

/** Extensions safe to show in the text/JSON viewer. */
const TEXT_EXTENSIONS = new Set([
  'txt',
  'json',
  'log',
  'md',
  'markdown',
  'csv',
  'tsv',
  'xml',
  'html',
  'htm',
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'css',
  'scss',
  'yml',
  'yaml',
  'ini',
  'conf',
  'env',
  'properties',
  'plist',
  'svg',
  'graphql',
  'sql',
]);

export function classifyFile(name: string): FilePreviewKind {
  const extension = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image';
  }
  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }
  return 'binary';
}

/** Normalize a native filesystem path into a uri RN's <Image>/network can load. */
export function toFileUri(path: string): string {
  if (path.startsWith('file://') || path.includes('://')) {
    return path;
  }
  return `file://${path}`;
}

/** Local date+time for a file's mtime. Returns "—" when unknown. */
export function formatDateTime(epochMs: number | undefined): string {
  if (epochMs == null || epochMs <= 0) {
    return '—';
  }
  const date = new Date(epochMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
