import { describe, it, expect } from '@jest/globals';
import { classifyFile, formatDateTime, toFileUri } from '../file-types';

describe('classifyFile', () => {
  it('classifies known image extensions as image', () => {
    expect(classifyFile('avatar.jpg')).toBe('image');
    expect(classifyFile('icon.WEBP')).toBe('image');
  });

  it('classifies text/JSON/source extensions as text', () => {
    expect(classifyFile('config.json')).toBe('text');
    expect(classifyFile('notes.md')).toBe('text');
    expect(classifyFile('index.tsx')).toBe('text');
  });

  it('falls back to binary for unknown or missing extensions', () => {
    expect(classifyFile('data.sqlite')).toBe('binary');
    expect(classifyFile('blob')).toBe('binary');
  });
});

describe('toFileUri', () => {
  it('prefixes a bare path with file://', () => {
    expect(toFileUri('/data/user/0/app/files/a.png')).toBe(
      'file:///data/user/0/app/files/a.png'
    );
  });

  it('leaves an existing scheme untouched', () => {
    expect(toFileUri('file:///a/b.png')).toBe('file:///a/b.png');
    expect(toFileUri('content://media/1')).toBe('content://media/1');
  });
});

describe('formatDateTime', () => {
  it('returns a dash for missing timestamps', () => {
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime(0)).toBe('—');
  });

  it('formats a timestamp as YYYY-MM-DD HH:MM', () => {
    const epochMs = new Date(2026, 6, 29, 9, 5).getTime();
    expect(formatDateTime(epochMs)).toBe('2026-07-29 09:05');
  });
});
