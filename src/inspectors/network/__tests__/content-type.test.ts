import { describe, it, expect } from '@jest/globals';
import {
  base64ByteLength,
  headerValue,
  isHtmlMediaType,
  isHtmlResponse,
  isImageMediaType,
  isImageResponse,
  mediaTypeOf,
  normalizeImageDataUri,
  responseMediaType,
} from '../content-type';
import type { NetworkEvent } from '../../../core/types';

function event(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
  return {
    id: 'n-1',
    sessionId: 's',
    timestamp: 1,
    kind: 'network',
    method: 'GET',
    url: 'https://cdn.example.com/avatar.png',
    requestHeaders: {},
    requestBodyTruncated: false,
    responseBodyTruncated: false,
    phase: 'success',
    ...overrides,
  };
}

describe('headerValue', () => {
  it('matches header names case-insensitively', () => {
    expect(headerValue({ 'Content-Type': 'image/png' }, 'content-type')).toBe(
      'image/png'
    );
    expect(headerValue({ 'content-type': 'image/png' }, 'Content-Type')).toBe(
      'image/png'
    );
  });

  it('returns undefined for missing headers and missing maps', () => {
    expect(headerValue({ Accept: '*/*' }, 'content-type')).toBeUndefined();
    expect(headerValue(undefined, 'content-type')).toBeUndefined();
  });
});

describe('mediaTypeOf', () => {
  it('strips parameters and normalizes case', () => {
    expect(mediaTypeOf('Image/PNG; charset=binary')).toBe('image/png');
    expect(mediaTypeOf('  image/jpeg  ')).toBe('image/jpeg');
  });

  it('returns an empty string when there is no content type', () => {
    expect(mediaTypeOf(undefined)).toBe('');
  });
});

describe('isImageMediaType', () => {
  it('accepts the types RN can decode', () => {
    expect(isImageMediaType('image/png')).toBe(true);
    expect(isImageMediaType('image/webp')).toBe(true);
  });

  it('rejects SVG, which RN cannot render, and non-images', () => {
    expect(isImageMediaType('image/svg+xml')).toBe(false);
    expect(isImageMediaType('application/json')).toBe(false);
    expect(isImageMediaType('')).toBe(false);
  });
});

describe('isImageResponse', () => {
  it('reads the media type from the response headers', () => {
    expect(
      isImageResponse(
        event({ responseHeaders: { 'Content-Type': 'image/jpeg' } })
      )
    ).toBe(true);
  });

  it('is false when the response is JSON, or has no headers', () => {
    expect(
      isImageResponse(
        event({ responseHeaders: { 'content-type': 'application/json' } })
      )
    ).toBe(false);
    expect(isImageResponse(event())).toBe(false);
  });

  it('ignores the URL — the server-declared type decides', () => {
    const jsonAtPngUrl = event({
      url: 'https://cdn.example.com/thing.png',
      responseHeaders: { 'content-type': 'application/json' },
    });
    expect(isImageResponse(jsonAtPngUrl)).toBe(false);
  });
});

describe('isHtmlMediaType', () => {
  it('accepts documents a web view lays out', () => {
    expect(isHtmlMediaType('text/html')).toBe(true);
    expect(isHtmlMediaType('application/xhtml+xml')).toBe(true);
  });

  it('rejects markup with no presentation, and non-documents', () => {
    expect(isHtmlMediaType('text/xml')).toBe(false);
    expect(isHtmlMediaType('application/json')).toBe(false);
    expect(isHtmlMediaType('')).toBe(false);
  });
});

describe('isHtmlResponse', () => {
  it('reads the media type from the response headers, charset and all', () => {
    expect(
      isHtmlResponse(
        event({
          responseHeaders: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      )
    ).toBe(true);
  });

  it('is false when the response is JSON, or has no headers', () => {
    expect(
      isHtmlResponse(
        event({ responseHeaders: { 'content-type': 'application/json' } })
      )
    ).toBe(false);
    expect(isHtmlResponse(event())).toBe(false);
  });
});

describe('responseMediaType', () => {
  it('returns the bare media type of the response', () => {
    expect(
      responseMediaType(
        event({ responseHeaders: { 'Content-Type': 'image/gif; q=1' } })
      )
    ).toBe('image/gif');
  });
});

describe('normalizeImageDataUri', () => {
  it('keeps a data uri that already declares an image type', () => {
    expect(
      normalizeImageDataUri('data:image/png;base64,AAAA', 'image/gif')
    ).toBe('data:image/png;base64,AAAA');
  });

  it('substitutes the response media type when the blob type is unusable', () => {
    expect(normalizeImageDataUri('data:;base64,AAAA', 'image/png')).toBe(
      'data:image/png;base64,AAAA'
    );
    expect(
      normalizeImageDataUri(
        'data:application/octet-stream;base64,AAAA',
        'image/jpeg'
      )
    ).toBe('data:image/jpeg;base64,AAAA');
  });

  it('returns null when there is no base64 payload to render', () => {
    expect(
      normalizeImageDataUri('data:image/png;base64,', 'image/png')
    ).toBeNull();
    expect(normalizeImageDataUri('not-a-data-uri', 'image/png')).toBeNull();
    expect(normalizeImageDataUri('data:image/png,raw', 'image/png')).toBeNull();
  });
});

describe('base64ByteLength', () => {
  it('accounts for padding', () => {
    // "hi" -> aGk=, "hey" -> aGV5
    expect(base64ByteLength('aGk=')).toBe(2);
    expect(base64ByteLength('aGV5')).toBe(3);
    expect(base64ByteLength('aA==')).toBe(1);
    expect(base64ByteLength('')).toBe(0);
  });
});
