import { describe, it, expect } from '@jest/globals';
import { extensionOf, mimeTypeOf } from '../mime-types';

describe('extensionOf', () => {
  it('lowercases the extension after the last dot', () => {
    expect(extensionOf('Photo.PNG')).toBe('png');
    expect(extensionOf('archive.tar.gz')).toBe('gz');
  });

  it('treats extensionless and dotfiles as having no extension', () => {
    expect(extensionOf('README')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('mimeTypeOf', () => {
  it('maps known extensions to their MIME type (case-insensitive)', () => {
    expect(mimeTypeOf('report.JSON')).toBe('application/json');
    expect(mimeTypeOf('photo.png')).toBe('image/png');
    expect(mimeTypeOf('notes.md')).toBe('text/markdown');
  });

  it('returns an empty string for unknown or missing extensions', () => {
    expect(mimeTypeOf('archive.bin')).toBe('');
    expect(mimeTypeOf('LICENSE')).toBe('');
    expect(mimeTypeOf('.gitignore')).toBe('');
  });
});
