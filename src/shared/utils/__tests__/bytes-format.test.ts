import { describe, it, expect } from '@jest/globals';
import { formatBytes } from '../bytes-format';

describe('formatBytes', () => {
  it('returns a dash for unknown sizes', () => {
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });

  it('shows raw bytes below 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('scales to larger units with one decimal below ten', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(45 * 1024 * 1024)).toBe('45 MB');
  });
});
