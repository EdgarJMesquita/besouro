import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// share.ts binds the native module's default export at import, so each test
// resets the module registry and re-mocks the native module before requiring it.
// The mock sets `__esModule: true` so esModuleInterop unwraps `default`.
const NATIVE_PATH = '../../native/NativeBesouro';

function loadShare() {
  return require('../share') as typeof import('../share');
}

function mockNative(native: unknown) {
  jest.doMock(NATIVE_PATH, () => ({ __esModule: true, default: native }));
}

describe('core/share', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('reports unavailable and no-ops when the native module is absent', () => {
    mockNative(null);
    const { isShareAvailable, shareFile } = loadShare();
    expect(isShareAvailable()).toBe(false);
    expect(shareFile('/docs/a.png')).toBe(false);
  });

  it('calls native shareFile with a MIME type derived from the extension', () => {
    const shareFileNative = jest.fn();
    mockNative({ shareFile: shareFileNative });
    const { isShareAvailable, shareFile } = loadShare();

    expect(isShareAvailable()).toBe(true);
    expect(shareFile('/docs/report.json')).toBe(true);
    expect(shareFileNative).toHaveBeenCalledWith(
      '/docs/report.json',
      'application/json'
    );
  });

  it('sends a real sandbox path through untouched, typed image/png', () => {
    // The Android side builds its ClipData's ClipDescription from this exact
    // MIME string; a wrong or empty type is what makes WhatsApp/Slack reject a
    // shared image. The path is a realistic sandbox one, whose directory
    // segments contain dots — mimeTypeOf is fed the whole path, not a basename.
    const shareFileNative = jest.fn();
    mockNative({ shareFile: shareFileNative });
    const { shareFile } = loadShare();

    const path = '/data/user/0/com.foo.bar/files/screenshot.png';
    expect(shareFile(path)).toBe(true);
    expect(shareFileNative).toHaveBeenCalledWith(path, 'image/png');
  });

  it('still resolves image/png when a directory segment contains dots', () => {
    const shareFileNative = jest.fn();
    mockNative({ shareFile: shareFileNative });
    const { shareFile } = loadShare();

    const path = '/data/user/0/com.foo.bar/cache/v1.2/logo.png';
    shareFile(path);
    expect(shareFileNative).toHaveBeenCalledWith(path, 'image/png');
  });

  it('passes an empty MIME type for unknown extensions', () => {
    const shareFileNative = jest.fn();
    mockNative({ shareFile: shareFileNative });
    const { shareFile } = loadShare();

    shareFile('/docs/archive.bin');
    expect(shareFileNative).toHaveBeenCalledWith('/docs/archive.bin', '');
  });

  it('returns false (does not throw) when the native call throws', () => {
    const shareFileNative = jest.fn(() => {
      throw new Error('native presentation failed');
    });
    mockNative({ shareFile: shareFileNative });
    const { shareFile } = loadShare();

    expect(shareFile('/docs/a.png')).toBe(false);
  });
});

describe('core/share — shareImage', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('splits the data uri, sending native the bare base64 payload', () => {
    // The native side feeds this straight to Base64.decode /
    // initWithBase64EncodedString:, so the `data:…;base64,` prefix must be gone.
    const shareBase64File = jest.fn();
    mockNative({ shareBase64File });
    const { shareImage } = loadShare();

    expect(shareImage('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(shareBase64File).toHaveBeenCalledWith(
      'iVBORw0KGgo=',
      'devtools-image.png',
      'image/png'
    );
  });

  it('names JPEG files .jpg, not .jpeg', () => {
    const shareBase64File = jest.fn();
    mockNative({ shareBase64File });
    const { shareImage } = loadShare();

    shareImage('data:image/jpeg;base64,AAAA');
    expect(shareBase64File).toHaveBeenCalledWith(
      'AAAA',
      'devtools-image.jpg',
      'image/jpeg'
    );
  });

  it('reuses one filename per media type so a repeat share overwrites', () => {
    // Android can only sweep the temporary copy, never delete it after the
    // share — a stable name is what keeps the leftovers to a single file.
    const shareBase64File = jest.fn();
    mockNative({ shareBase64File });
    const { shareImage } = loadShare();

    shareImage('data:image/webp;base64,AAAA');
    shareImage('data:image/webp;base64,BBBB');
    const names = shareBase64File.mock.calls.map((call) => call[1]);
    expect(names).toEqual(['devtools-image.webp', 'devtools-image.webp']);
  });

  it('rejects anything that is not a base64 data uri', () => {
    const shareBase64File = jest.fn();
    mockNative({ shareBase64File });
    const { shareImage } = loadShare();

    expect(shareImage('https://cdn.example.com/a.png')).toBe(false);
    expect(shareImage('data:image/png,notbase64')).toBe(false);
    expect(shareImage('data:image/png;base64,')).toBe(false);
    expect(shareBase64File).not.toHaveBeenCalled();
  });

  it('no-ops when the native module is absent, and when it throws', () => {
    mockNative(null);
    expect(loadShare().shareImage('data:image/png;base64,AAAA')).toBe(false);

    jest.resetModules();
    mockNative({
      shareBase64File: jest.fn(() => {
        throw new Error('native presentation failed');
      }),
    });
    expect(loadShare().shareImage('data:image/png;base64,AAAA')).toBe(false);
  });
});
