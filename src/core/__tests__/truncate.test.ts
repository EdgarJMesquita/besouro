import { describe, it, expect } from '@jest/globals';
import { truncateToBytes } from '../truncate';

describe('truncateToBytes', () => {
  it('returns the input unchanged when within budget', () => {
    const result = truncateToBytes('hello', 100);
    expect(result).toEqual({ text: 'hello', truncated: false, byteLength: 5 });
  });

  it('truncates ASCII to the byte budget', () => {
    const result = truncateToBytes('abcdef', 3);
    expect(result.text).toBe('abc');
    expect(result.truncated).toBe(true);
    expect(result.byteLength).toBe(6);
  });

  it('counts multibyte characters by their UTF-8 length', () => {
    // '€' is 3 UTF-8 bytes.
    const result = truncateToBytes('€€', 10);
    expect(result.truncated).toBe(false);
    expect(result.byteLength).toBe(6);
  });

  it('does not split a multibyte character across the budget', () => {
    // Budget of 2 bytes cannot fit a 3-byte '€', so nothing is kept.
    const result = truncateToBytes('€abc', 2);
    expect(result.text).toBe('');
    expect(result.truncated).toBe(true);
  });

  it('treats a surrogate pair as a single 4-byte code point', () => {
    // '😀' is a surrogate pair (4 UTF-8 bytes).
    const withinBudget = truncateToBytes('😀', 4);
    expect(withinBudget.text).toBe('😀');
    expect(withinBudget.truncated).toBe(false);

    const belowBudget = truncateToBytes('😀', 3);
    expect(belowBudget.text).toBe('');
    expect(belowBudget.truncated).toBe(true);
  });
});
