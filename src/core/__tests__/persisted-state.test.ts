import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// persisted-state binds the native module's default export at import, so each test
// resets the module registry and re-mocks the native module before requiring it.
// The mock sets `__esModule: true` so esModuleInterop unwraps `default`.
const NATIVE_PATH = '../../native/NativeBesouro';

function loadStore() {
  return require('../persisted-state') as typeof import('../persisted-state');
}

function mockNative(native: unknown) {
  jest.doMock(NATIVE_PATH, () => ({ __esModule: true, default: native }));
}

describe('persisted-state', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns the fallback for an unset key', () => {
    mockNative(null);
    const { getConfig } = loadStore();
    expect(getConfig('missing', 'fallback')).toBe('fallback');
  });

  it('no-ops without a native module (no throw on set/hydrate)', async () => {
    mockNative(null);
    const { getConfig, setConfig, hydrateConfig } = loadStore();
    await expect(hydrateConfig()).resolves.toBeUndefined();
    expect(() => setConfig('k', 'v')).not.toThrow();
    // Value is still held in memory even though it can't be written.
    expect(getConfig('k', 'fallback')).toBe('v');
  });

  it('persists a set value to the native file', async () => {
    const writeFile = jest
      .fn<(name: string, content: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockNative({ readFile: jest.fn(), writeFile });
    const { setConfig } = loadStore();

    setConfig('network.urlMode', 'first');
    await Promise.resolve();

    expect(writeFile).toHaveBeenCalledTimes(1);
    const [, content] = writeFile.mock.calls[0]!;
    expect(JSON.parse(content)).toEqual({ 'network.urlMode': 'first' });
  });

  it('does not notify or persist when an identical value is re-set', async () => {
    const writeFile = jest
      .fn<(name: string, content: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    mockNative({ readFile: jest.fn(), writeFile });
    const { setConfig } = loadStore();

    setConfig('k', 'v');
    setConfig('k', 'v');
    await Promise.resolve();

    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  it('hydrates persisted values from the native file', async () => {
    const readFile = jest
      .fn<(name: string) => Promise<string | null>>()
      .mockResolvedValue('{"fileSystem.viewMode":"grid"}');
    mockNative({ readFile, writeFile: jest.fn() });
    const { getConfig, hydrateConfig } = loadStore();

    expect(getConfig('fileSystem.viewMode', 'list')).toBe('list');
    await hydrateConfig();
    expect(getConfig('fileSystem.viewMode', 'list')).toBe('grid');
  });

  it('keeps defaults when the file is missing or corrupt', async () => {
    const readFile = jest
      .fn<(name: string) => Promise<string | null>>()
      .mockResolvedValue('not json');
    mockNative({ readFile, writeFile: jest.fn() });
    const { getConfig, hydrateConfig } = loadStore();

    await hydrateConfig();
    expect(getConfig('fileSystem.viewMode', 'list')).toBe('list');
  });
});
