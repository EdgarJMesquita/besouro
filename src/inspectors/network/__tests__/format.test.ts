import { describe, it, expect } from '@jest/globals';
import { formatUrl, buildCurl } from '../format';
import type { NetworkEvent } from '../../../core/types';

describe('formatUrl', () => {
  const url = 'https://api.example.com/v1/users/12345/profile?tab=info';

  it('returns the whole URL without the query string in full mode', () => {
    expect(formatUrl(url, 'full')).toBe(
      'https://api.example.com/v1/users/12345/profile'
    );
  });

  it('returns the path without the query string in path mode', () => {
    expect(formatUrl(url, 'path')).toBe('/v1/users/12345/profile');
  });

  it('returns the last path segment, ignoring the query, in last mode', () => {
    expect(formatUrl(url, 'last')).toBe('profile');
  });

  it('falls back to the whole URL when there is no path', () => {
    expect(formatUrl('https://example.com', 'full')).toBe(
      'https://example.com'
    );
    expect(formatUrl('https://example.com', 'path')).toBe(
      'https://example.com'
    );
    expect(formatUrl('https://example.com', 'last')).toBe(
      'https://example.com'
    );
  });

  it('treats a bare trailing slash as no path', () => {
    expect(formatUrl('https://example.com/', 'full')).toBe(
      'https://example.com'
    );
    expect(formatUrl('https://example.com/', 'path')).toBe(
      'https://example.com'
    );
    expect(formatUrl('https://example.com/', 'last')).toBe(
      'https://example.com'
    );
    expect(formatUrl('https://example.com/?tab=info', 'last')).toBe(
      'https://example.com'
    );
  });

  it('ignores a trailing slash after a real path', () => {
    expect(formatUrl('https://example.com/api/items/', 'full')).toBe(
      'https://example.com/api/items'
    );
    expect(formatUrl('https://example.com/api/items/', 'path')).toBe(
      '/api/items'
    );
    expect(formatUrl('https://example.com/api/items/', 'last')).toBe('items');
  });
});

describe('buildCurl', () => {
  function event(overrides: Partial<NetworkEvent> = {}): NetworkEvent {
    return {
      id: 'n-1',
      sessionId: 's',
      timestamp: 1,
      kind: 'network',
      method: 'POST',
      url: 'https://api.example.com/login',
      requestHeaders: { 'Content-Type': 'application/json' },
      requestBodyTruncated: false,
      responseBodyTruncated: false,
      phase: 'success',
      ...overrides,
    };
  }

  it('includes method, url, and headers', () => {
    const curl = buildCurl(event());
    expect(curl).toContain("curl -X POST 'https://api.example.com/login'");
    expect(curl).toContain("-H 'Content-Type: application/json'");
  });

  it('includes the request body as --data', () => {
    const curl = buildCurl(event({ requestBody: '{"user":"ada"}' }));
    expect(curl).toContain(`--data '{"user":"ada"}'`);
  });

  it('escapes single quotes in the body', () => {
    const curl = buildCurl(event({ requestBody: "it's" }));
    expect(curl).toContain("it'\\''s");
  });

  it('omits --data when there is no body', () => {
    expect(buildCurl(event())).not.toContain('--data');
  });
});
