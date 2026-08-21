/**
 * Filename → extension → MIME type. Pure and dependency-free, so both the share
 * bridge (`core/share`) and the File System inspector can use it without either
 * importing the other.
 */

/** Lowercased extension without the dot, or '' when there is none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  // No dot, or a leading-dot dotfile (e.g. ".gitignore") — treat as extensionless.
  if (dot <= 0) {
    return '';
  }
  return name.slice(dot + 1).toLowerCase();
}

const MIME_TYPES: Record<string, string> = {
  // Text / code
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  ts: 'text/plain',
  tsx: 'text/plain',
  jsx: 'text/plain',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  sql: 'application/sql',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  // Other common
  pdf: 'application/pdf',
  zip: 'application/zip',
};

/**
 * Best-effort MIME type from a filename's extension, used to label a file for
 * the OS share sheet (Android needs an explicit type; iOS ignores it). Returns
 * '' when unknown — the native side then falls back to a generic binary type.
 */
export function mimeTypeOf(name: string): string {
  return MIME_TYPES[extensionOf(name)] ?? '';
}
