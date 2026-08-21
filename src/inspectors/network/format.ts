/**
 * Pure formatting helpers for the Network tab — URL display modes and copy-as-cURL
 * reconstruction (§6.1). Kept free of React Native imports so they are
 * unit-testable in isolation.
 */

import type { NetworkEvent } from '../../core/types';

/** How much of a URL to show in the list: whole URL, path, or last path segment. */
export type UrlMode = 'full' | 'path' | 'last';

/**
 * Format a URL for display in the list according to the selected {@link UrlMode}.
 * The query string and fragment are always stripped — request rows would be
 * unreadable with long param lists; the full URL + params stays in the detail view.
 */
export function formatUrl(url: string, mode: UrlMode): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? url;
  const full = stripTrailingSlash(withoutQuery);
  if (mode === 'full') {
    return full;
  }
  // A root URL (`https://example.com`, `https://example.com/`) has no path worth
  // showing — a lone `/` in the row tells the reader nothing, so fall back to
  // the whole URL instead.
  const segments = pathSegments(withoutQuery);
  if (segments.length === 0) {
    return full;
  }
  return mode === 'path'
    ? `/${segments.join('/')}`
    : (segments[segments.length - 1] ?? full);
}

/** Drop trailing slashes so `https://example.com/` and `https://example.com` render identically. */
function stripTrailingSlash(value: string): string {
  const trimmed = value.replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : value;
}

/** The non-empty path segments of a URL, with the scheme and host removed. */
function pathSegments(url: string): string[] {
  const withoutScheme = url.replace(/^[a-zA-Z][\w+.-]*:\/\//, '');
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex === -1) {
    return [];
  }
  return withoutScheme
    .slice(slashIndex)
    .split('/')
    .filter((segment) => segment.length > 0);
}

/** Reconstruct an equivalent `curl` command for a captured request. */
export function buildCurl(event: NetworkEvent): string {
  const parts = [`curl -X ${event.method} '${event.url}'`];
  for (const [name, value] of Object.entries(event.requestHeaders)) {
    parts.push(`-H '${name}: ${value}'`);
  }
  if (event.requestBody) {
    parts.push(`--data '${event.requestBody.replace(/'/g, "'\\''")}'`);
  }
  return parts.join(' \\\n  ');
}
