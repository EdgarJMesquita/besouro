/**
 * Response content-type helpers for the Network inspector: finding the media type
 * in a header map, deciding whether a response is an image the drawer can render,
 * and normalizing captured bytes into a data uri `<Image>` accepts. Kept free of
 * React Native imports so they are unit-testable in isolation (mirrors format.ts).
 */

import type { NetworkEvent } from '../../core/types';

/** Case-insensitive header lookup — servers vary the casing of header names. */
export function headerValue(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const wanted = name.toLowerCase();
  for (const [header, value] of Object.entries(headers)) {
    if (header.toLowerCase() === wanted) {
      return value;
    }
  }
  return undefined;
}

/** The media type of a `Content-Type` header, lowercased and without parameters. */
export function mediaTypeOf(contentType: string | undefined): string {
  return (contentType?.split(';')[0] ?? '').trim().toLowerCase();
}

/** The media type the server reported for a captured response, or ''. */
export function responseMediaType(event: NetworkEvent): string {
  return mediaTypeOf(headerValue(event.responseHeaders, 'content-type'));
}

/**
 * Media types RN's `<Image>` decodes. SVG is deliberately absent: RN has no
 * built-in SVG support, and an SVG body is XML that reads fine in the text viewer.
 */
const IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/heic',
  'image/heif',
]);

export function isImageMediaType(mediaType: string): boolean {
  return IMAGE_MEDIA_TYPES.has(mediaType);
}

/** Whether a response should be shown as an image rather than as text. */
export function isImageResponse(event: NetworkEvent): boolean {
  return isImageMediaType(responseMediaType(event));
}

/**
 * Media types the response tab renders as a page. XHTML is included because it
 * is a document a web view lays out; `text/xml` and friends are not — they have
 * no presentation, so the text viewer serves them better.
 */
const HTML_MEDIA_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export function isHtmlMediaType(mediaType: string): boolean {
  return HTML_MEDIA_TYPES.has(mediaType);
}

/** Whether a response can be previewed as a rendered page. */
export function isHtmlResponse(event: NetworkEvent): boolean {
  return isHtmlMediaType(responseMediaType(event));
}

/**
 * Turn a `FileReader.readAsDataURL` result into a uri `<Image>` can render. RN
 * blobs sometimes carry an empty or generic `type`, which yields a uri no decoder
 * accepts, so the media type from the response headers is substituted in that
 * case. Returns null when the result carries no base64 payload.
 */
export function normalizeImageDataUri(
  dataUri: string,
  mediaType: string
): string | null {
  const marker = ';base64,';
  const markerIndex = dataUri.indexOf(marker);
  if (!dataUri.startsWith('data:') || markerIndex === -1) {
    return null;
  }
  const base64 = dataUri.slice(markerIndex + marker.length);
  if (base64.length === 0) {
    return null;
  }
  const declared = dataUri.slice('data:'.length, markerIndex).toLowerCase();
  return isImageMediaType(declared)
    ? dataUri
    : `data:${mediaType};base64,${base64}`;
}

/** Decoded byte length of a base64 payload, without decoding it. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Per-image ceiling for a captured preview — 10 MB, which covers anything a phone
 * camera produces, not just icons, thumbnails and hero images.
 *
 * Checked against the response's size *before* any decoding, so an oversized
 * image is never read into JS as base64: the event still records its size, only
 * the preview is skipped. This is a JS-heap guard, not a storage one — previews
 * are written to the database once and never re-serialized, so there is no
 * session-wide budget for them to fit inside.
 *
 * What keeps it from going higher is that a preview is held as a base64 data uri,
 * which costs 4/3 of the image, and then crosses the bridge as a JSON string — so
 * the transient heap is a few times the number here. Going meaningfully past this
 * wants a different mechanism (spill the blob to a file, store the path) rather
 * than a bigger string.
 */
export const MAX_IMAGE_BYTES = 10_000_000;
