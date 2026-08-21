/**
 * Dev-server filtering. `react-native` is mocked down to the one constant the
 * filter reads — `SourceCode.scriptURL`, the url the bundle was loaded from —
 * and each test rewrites it to stand for a packager / release / web build.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const sourceCode: { scriptURL?: string } = {};

jest.mock('react-native', () => ({
  NativeModules: { SourceCode: sourceCode },
}));

import { isDevServerRequest, resetDevServerOrigin } from '../dev-server';

function bundleLoadedFrom(url: string | undefined): void {
  sourceCode.scriptURL = url;
  resetDevServerOrigin();
}

describe('isDevServerRequest', () => {
  beforeEach(() => {
    bundleLoadedFrom(
      'http://192.168.0.12:8081/index.bundle?platform=ios&dev=true'
    );
  });

  it('filters Metro endpoints on the packager origin', () => {
    expect(isDevServerRequest('http://192.168.0.12:8081/symbolicate')).toBe(
      true
    );
    expect(isDevServerRequest('http://192.168.0.12:8081/logs')).toBe(true);
    expect(
      isDevServerRequest('http://192.168.0.12:8081/inspector/device?device=1')
    ).toBe(true);
    expect(
      isDevServerRequest('http://192.168.0.12:8081/index.map?platform=ios')
    ).toBe(true);
  });

  it('keeps app traffic, including other ports on the same host', () => {
    expect(isDevServerRequest('https://api.example.com/v1/users')).toBe(false);
    expect(isDevServerRequest('http://192.168.0.12:3000/logs')).toBe(false);
    expect(isDevServerRequest('http://localhost:8081/symbolicate')).toBe(false);
  });

  it('matches the origin case-insensitively', () => {
    bundleLoadedFrom('http://LOCALHOST:8081/index.bundle');
    expect(isDevServerRequest('http://localhost:8081/symbolicate')).toBe(true);
  });

  it('filters nothing when the bundle came off disk', () => {
    bundleLoadedFrom('file:///var/containers/app/main.jsbundle');
    expect(isDevServerRequest('http://192.168.0.12:8081/symbolicate')).toBe(
      false
    );

    bundleLoadedFrom('assets://index.android.bundle');
    expect(isDevServerRequest('http://10.0.2.2:8081/symbolicate')).toBe(false);
  });

  it('filters nothing when the script url is unavailable', () => {
    bundleLoadedFrom(undefined);
    expect(isDevServerRequest('http://192.168.0.12:8081/symbolicate')).toBe(
      false
    );
  });

  it('ignores malformed request urls', () => {
    expect(isDevServerRequest('')).toBe(false);
    expect(isDevServerRequest('/relative/path')).toBe(false);
  });
});
