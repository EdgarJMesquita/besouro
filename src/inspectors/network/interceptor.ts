/**
 * Network capture mechanism — internal.
 *
 * Patches the global `XMLHttpRequest` prototype directly (`open` / `setRequestHeader`
 * / `send`) rather than depending on RN's private `XHRInterceptor` module, whose
 * path changes between RN versions. Because RN's own `fetch` is built on XHR, this
 * single hook captures `fetch`, `axios`, and any XHR-based client. `expo/fetch` is
 * a native implementation that bypasses XHR entirely, so it is *not* captured.
 *
 * Requests to the Metro/Expo dev server are dropped before they reach the store
 * (`./dev-server`) — that traffic is the packager's, not the app's.
 *
 * `installNetworkInspector` is the entry point, called by the controller.
 */

import { patchMethod, safeCapture } from '../../core/base-interceptor';
import { captureEvent, createEventId, patchEvent } from '../../core/capture';
import { getCurrentSession } from '../../core/session';
import { truncateToBytes } from '../../core/truncate';
import { safeStringify } from '../../core/serialize';
import type { NetworkEvent } from '../../core/types';
import {
  base64ByteLength,
  headerValue,
  isImageMediaType,
  mediaTypeOf,
  normalizeImageDataUri,
  MAX_IMAGE_BYTES,
} from './content-type';
import { isDevServerRequest } from './dev-server';

/**
 * Per-body ceiling for a captured request/response — 1 MB, which clears the large
 * JSON list and GraphQL responses that a 100 KB cap used to cut mid-payload.
 *
 * Not configurable, and deliberately so: the raw body is already fully in JS by the
 * time this applies, so the number only decides how much of it is serialized across
 * the bridge and kept in SQLite. Image responses never reach here — they return
 * early to {@link captureResponseImage}, under {@link MAX_IMAGE_BYTES}.
 */
const MAX_BODY_BYTES = 1_000_000;

/** Per-request state stashed on the XHR instance under a private symbol. */
const REQUEST_STATE = Symbol.for('besouro.xhr-state');

interface RequestState {
  eventId: string;
  method: string;
  url: string;
  startTime: number;
  requestHeaders: Record<string, string>;
  recorded: boolean;
}

/** Structural subset of an `XMLHttpRequest` instance we read from. */
interface XHRLike {
  [REQUEST_STATE]?: RequestState;
  status: number;
  responseText?: string;
  response?: unknown;
  responseType?: string;
  getAllResponseHeaders(): string;
  addEventListener(type: string, listener: () => void): void;
}

/** Minimal FileReader surface — RN's `fetch` returns blob bodies we read as text. */
interface FileReaderLike {
  result: string | null;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  readAsText(blob: unknown): void;
  readAsDataURL(blob: unknown): void;
}

interface XHRPrototype {
  open: (
    this: XHRLike,
    method: string,
    url: string,
    ...rest: unknown[]
  ) => void;
  send: (this: XHRLike, body?: unknown) => void;
  setRequestHeader: (this: XHRLike, header: string, value: string) => void;
}

function getXHRPrototype(): XHRPrototype | null {
  const constructor = (
    globalThis as { XMLHttpRequest?: { prototype?: unknown } }
  ).XMLHttpRequest;
  const prototype = constructor?.prototype;
  return prototype ? (prototype as XHRPrototype) : null;
}

export function installNetworkInspector(): () => void {
  const prototype = getXHRPrototype();
  if (!prototype) {
    // Signals guardInstall to mark this inspector degraded (§5).
    throw new Error('XMLHttpRequest is unavailable in this environment');
  }
  const restores = [
    patchMethod(prototype, 'open', (original) => {
      const openOriginal = original;
      return function (this: XHRLike, method, url, ...rest) {
        safeCapture(() => {
          this[REQUEST_STATE] = {
            eventId: createEventId(),
            method,
            url,
            startTime: 0,
            requestHeaders: {},
            recorded: false,
          };
        });
        return openOriginal.call(this, method, url, ...rest);
      };
    }),

    patchMethod(prototype, 'setRequestHeader', (original) => {
      const setHeaderOriginal = original;
      return function (this: XHRLike, header, value) {
        safeCapture(() => {
          const state = this[REQUEST_STATE];
          if (state) {
            state.requestHeaders[header] = value;
          }
        });
        return setHeaderOriginal.call(this, header, value);
      };
    }),

    patchMethod(prototype, 'send', (original) => {
      const sendOriginal = original;
      return function (this: XHRLike, body) {
        safeCapture(() => beginRequest(this, body));
        return sendOriginal.call(this, body);
      };
    }),
  ];

  return () => {
    for (const restore of restores) {
      restore();
    }
  };
}

/** Record the pending request and attach completion listeners on `send`. */
function beginRequest(xhr: XHRLike, body: unknown): void {
  const state = xhr[REQUEST_STATE];
  if (!state || isDevServerRequest(state.url)) {
    return;
  }
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  state.startTime = Date.now();

  const event: NetworkEvent = {
    id: state.eventId,
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'network',
    method: state.method,
    url: state.url,
    requestHeaders: { ...state.requestHeaders },
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    phase: 'pending',
  };
  if (body != null) {
    const { text, truncated } = truncateToBytes(
      safeStringify(body),
      MAX_BODY_BYTES
    );
    event.requestBody = text;
    event.requestBodyTruncated = truncated;
  }
  captureEvent(event);

  xhr.addEventListener('load', () =>
    safeCapture(() => finishRequest(xhr, 'success'))
  );
  for (const failure of ['error', 'timeout', 'abort']) {
    xhr.addEventListener(failure, () =>
      safeCapture(() => finishRequest(xhr, 'error'))
    );
  }
}

/** Capture the response once, on the first completion event. */
function finishRequest(xhr: XHRLike, outcome: 'success' | 'error'): void {
  const state = xhr[REQUEST_STATE];
  if (!state || state.recorded) {
    return;
  }
  state.recorded = true;

  const { eventId } = state;
  const status = xhr.status;
  const responseHeaders = parseHeaders(xhr.getAllResponseHeaders());
  // Record the metadata immediately; the body may resolve asynchronously (blob).
  patchEvent(eventId, 'network', {
    status,
    responseHeaders,
    durationMs: Date.now() - state.startTime,
    phase: outcome === 'error' || status === 0 ? 'error' : 'success',
  });

  // An image body is binary: decoded as text it is unreadable mojibake, and the
  // damage is irreversible, so it is captured as base64 for the preview instead.
  const mediaType = mediaTypeOf(headerValue(responseHeaders, 'content-type'));
  if (isImageMediaType(mediaType)) {
    captureResponseImage(xhr, eventId, mediaType);
    return;
  }

  readResponseBody(xhr, (rawBody) => {
    const { text, truncated, byteLength } = truncateToBytes(
      rawBody,
      MAX_BODY_BYTES
    );
    patchEvent(eventId, 'network', {
      responseBody: text,
      responseBodyTruncated: truncated,
      responseSizeBytes: byteLength,
    });
  });
}

/**
 * Capture an image response as a data uri for the detail view's preview.
 *
 * Only blob and base64 responses carry intact bytes — RN's `fetch` asks for a
 * blob, so that is the common path. A response whose bytes we can't reach (a
 * plain-text `responseType`, no FileReader) or that exceeds the caps records its
 * size only, and the preview reports that it can't be shown.
 */
function captureResponseImage(
  xhr: XHRLike,
  eventId: string,
  mediaType: string
): void {
  const response = xhr.response;
  if (response == null) {
    return;
  }

  // RN's non-standard `base64` responseType hands the payload back already encoded.
  if (xhr.responseType === 'base64' && typeof response === 'string') {
    const byteLength = base64ByteLength(response);
    patchEvent(eventId, 'network', { responseSizeBytes: byteLength });
    if (byteLength <= MAX_IMAGE_BYTES) {
      patchEvent(eventId, 'network', {
        responseImageUri: `data:${mediaType};base64,${response}`,
      });
    }
    return;
  }

  const size = blobSize(response);
  if (size == null) {
    return;
  }
  patchEvent(eventId, 'network', { responseSizeBytes: size });
  if (size > MAX_IMAGE_BYTES) {
    return;
  }
  readBlobAsDataUri(response, (dataUri) => {
    const uri = dataUri ? normalizeImageDataUri(dataUri, mediaType) : null;
    if (uri) {
      patchEvent(eventId, 'network', { responseImageUri: uri });
    }
  });
}

/** A Blob's byte size, or null when the response isn't blob-like. */
function blobSize(response: unknown): number | null {
  const size = (response as { size?: unknown }).size;
  return typeof size === 'number' ? size : null;
}

/** Read a Blob as a `data:` uri via FileReader. Yields null when unavailable. */
function readBlobAsDataUri(
  blob: unknown,
  onDataUri: (dataUri: string | null) => void
): void {
  const FileReaderCtor = (
    globalThis as { FileReader?: new () => FileReaderLike }
  ).FileReader;
  if (!FileReaderCtor) {
    onDataUri(null);
    return;
  }
  try {
    const reader = new FileReaderCtor();
    reader.onload = () =>
      onDataUri(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => onDataUri(null);
    reader.readAsDataURL(blob);
  } catch {
    onDataUri(null);
  }
}

/**
 * Read the response body as text and hand it to `onBody`. RN's `fetch` sets
 * `responseType` to `blob`, so `responseText` is unavailable and the body must be
 * read from the Blob asynchronously via FileReader; text/JSON responses resolve
 * synchronously.
 */
function readResponseBody(xhr: XHRLike, onBody: (body: string) => void): void {
  const responseType = xhr.responseType;
  if (!responseType || responseType === 'text') {
    try {
      onBody(xhr.responseText ?? '');
    } catch {
      onBody('');
    }
    return;
  }

  const response = xhr.response;
  if (response == null) {
    onBody('');
    return;
  }
  if (typeof response === 'string') {
    onBody(response);
    return;
  }
  if (responseType === 'blob' && readBlobAsText(response, onBody)) {
    return;
  }
  onBody(safeStringify(response));
}

/** Read a Blob's text via FileReader. Returns false if FileReader is unavailable. */
function readBlobAsText(
  blob: unknown,
  onText: (text: string) => void
): boolean {
  const FileReaderCtor = (
    globalThis as { FileReader?: new () => FileReaderLike }
  ).FileReader;
  if (!FileReaderCtor) {
    return false;
  }
  try {
    const reader = new FileReaderCtor();
    reader.onload = () =>
      onText(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => onText('');
    reader.readAsText(blob);
    return true;
  } catch {
    return false;
  }
}

/** Parse the raw `getAllResponseHeaders()` block into a name→value map. */
function parseHeaders(raw: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw) {
    return headers;
  }
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      headers[line.slice(0, separator).trim()] = line
        .slice(separator + 1)
        .trim();
    }
  }
  return headers;
}
