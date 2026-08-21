import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// The inspector binds the spec module's default export once at import, so each
// test resets the module registry and re-mocks the dedicated spec before
// importing. Mocks set `__esModule: true` so esModuleInterop unwraps `default` to
// the value below instead of re-wrapping it.
const SPEC_PATH = '../../../native/NativeBesouroFileSystem';

function loadBrowser() {
  return require('../browser') as typeof import('../browser');
}

describe('createFileSystemBrowser', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns null when the native module is not linked', () => {
    // `get` resolves to null for an unregistered module (Expo Go / web / tests),
    // so "not linked" is a null default export, not a throw.
    jest.doMock(SPEC_PATH, () => ({ __esModule: true, default: null }));
    const { createFileSystemBrowser, isFileSystemNativeAvailable } =
      loadBrowser();
    expect(isFileSystemNativeAvailable()).toBe(false);
    expect(createFileSystemBrowser()).toBeNull();
  });

  it('parses roots and directory listings from JSON', async () => {
    const native = {
      listRoots: jest
        .fn<() => Promise<string>>()
        .mockResolvedValue(
          '[{"key":"documents","label":"Documents","path":"/docs"}]'
        ),
      listDirectory: jest
        .fn<(path: string) => Promise<string>>()
        .mockResolvedValue(
          '[{"name":"a.txt","path":"/docs/a.txt","isDirectory":false,"sizeBytes":3}]'
        ),
      statPath: jest.fn(),
      readFileAtPath: jest.fn(),
    };
    jest.doMock(SPEC_PATH, () => ({ __esModule: true, default: native }));

    const browser = loadBrowser().createFileSystemBrowser();
    expect(browser).not.toBeNull();
    await expect(browser!.listRoots()).resolves.toEqual([
      { key: 'documents', label: 'Documents', path: '/docs' },
    ]);
    const entries = await browser!.listDirectory('/docs');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('a.txt');
    expect(native.listDirectory).toHaveBeenCalledWith('/docs');
  });

  it('degrades malformed or rejected native results to neutral values', async () => {
    const native = {
      listRoots: jest.fn<() => Promise<string>>().mockResolvedValue('not json'),
      listDirectory: jest
        .fn<(path: string) => Promise<string>>()
        .mockRejectedValue(new Error('EACCES')),
      statPath: jest
        .fn<(path: string) => Promise<string>>()
        .mockResolvedValue('{bad'),
      readFileAtPath: jest.fn(),
    };
    jest.doMock(SPEC_PATH, () => ({ __esModule: true, default: native }));

    const browser = loadBrowser().createFileSystemBrowser()!;
    await expect(browser.listRoots()).resolves.toEqual([]);
    await expect(browser.listDirectory('/x')).resolves.toEqual([]);
    await expect(browser.stat('/x')).resolves.toBeNull();
  });

  it('flags a full-budget read as truncated and passes null through', async () => {
    const native = {
      listRoots: jest.fn(),
      listDirectory: jest.fn(),
      statPath: jest.fn(),
      readFileAtPath:
        jest.fn<(path: string, maxBytes: number) => Promise<string | null>>(),
    };
    jest.doMock(SPEC_PATH, () => ({ __esModule: true, default: native }));
    const browser = loadBrowser().createFileSystemBrowser()!;

    native.readFileAtPath.mockResolvedValueOnce('abcd');
    await expect(browser.readText('/f', 4)).resolves.toEqual({
      text: 'abcd',
      truncated: true,
    });

    native.readFileAtPath.mockResolvedValueOnce('ab');
    await expect(browser.readText('/f', 4)).resolves.toEqual({
      text: 'ab',
      truncated: false,
    });

    native.readFileAtPath.mockResolvedValueOnce(null);
    await expect(browser.readText('/f', 4)).resolves.toBeNull();
  });
});
