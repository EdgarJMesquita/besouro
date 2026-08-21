import { describe, it, expect } from '@jest/globals';
import { formatDuration } from '../duration-format';

describe('formatDuration', () => {
  it('returns a dash for nullish input', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(null as unknown as number)).toBe('—');
  });

  it('shows whole milliseconds below one second', () => {
    expect(formatDuration(300)).toBe('300ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999.4)).toBe('999ms');
  });

  it('rolls up to seconds at the 1000ms boundary', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  it('shows whole seconds without decimals', () => {
    expect(formatDuration(44000)).toBe('44s');
  });

  it('shows up to two decimals for fractional seconds', () => {
    expect(formatDuration(44060)).toBe('44.06s');
  });

  it('trims trailing zeros in seconds', () => {
    expect(formatDuration(44100)).toBe('44.1s');
  });

  it('rolls up to minutes at the 60s boundary', () => {
    expect(formatDuration(60000)).toBe('1min');
  });

  it('shows minutes with a single decimal', () => {
    expect(formatDuration(102000)).toBe('1.7min');
  });

  it('trims a trailing .0 in minutes', () => {
    expect(formatDuration(120000)).toBe('2min');
  });
});
