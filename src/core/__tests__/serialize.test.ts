import { describe, it, expect } from '@jest/globals';
import { safeStringify, formatArguments, errorStack } from '../serialize';

describe('safeStringify', () => {
  it('returns strings verbatim', () => {
    expect(safeStringify('hello')).toBe('hello');
  });

  it('renders primitives', () => {
    expect(safeStringify(42)).toBe('42');
    expect(safeStringify(true)).toBe('true');
    expect(safeStringify(null)).toBe('null');
    expect(safeStringify(undefined)).toBe('undefined');
  });

  it('serializes plain objects as JSON', () => {
    expect(safeStringify({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
  });

  it('replaces circular references instead of throwing', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node.self = node;
    const result = safeStringify(node);
    expect(result).toContain('[Circular]');
  });

  it('names functions', () => {
    function handler(): void {}
    expect(safeStringify(handler)).toBe('[Function handler]');
    expect(safeStringify(() => {})).toContain('[Function');
  });

  it('stringifies bigint values', () => {
    expect(safeStringify(10n)).toBe('10');
  });

  // `JSON.stringify` renders these as "{}" — their contents are not own
  // enumerable properties — so each needs an explicit branch.
  it('renders errors as name + message, not {}', () => {
    expect(safeStringify(new Error('boom'))).toBe('Error: boom');
    expect(safeStringify(new TypeError('bad'))).toBe('TypeError: bad');
  });

  it('includes custom fields attached to an error', () => {
    const error = Object.assign(new Error('rejected'), { code: 401 });
    expect(safeStringify(error)).toBe('Error: rejected {"code":401}');
  });

  it('renders an error with no message as just its name', () => {
    expect(safeStringify(new RangeError())).toBe('RangeError');
  });

  it('renders map and set contents', () => {
    expect(safeStringify(new Map([['a', 1]]))).toBe('Map(1) {"a":1}');
    expect(safeStringify(new Set([1, 2]))).toBe('Set(2) [1,2]');
  });

  it('renders regexps', () => {
    expect(safeStringify(/foo/g)).toBe('/foo/g');
  });

  it('renders errors nested inside plain objects', () => {
    const result = safeStringify({ cause: new Error('inner') });
    expect(result).toBe('{"cause":"Error: inner"}');
  });

  it('still serializes dates via toJSON', () => {
    expect(safeStringify(new Date(0))).toBe('"1970-01-01T00:00:00.000Z"');
  });
});

describe('errorStack', () => {
  it('returns the stack of an error', () => {
    expect(errorStack(new Error('boom'))).toContain('Error: boom');
  });

  it('returns undefined for non-errors', () => {
    expect(errorStack('boom')).toBeUndefined();
    expect(errorStack({ stack: 'fake' })).toBeUndefined();
  });
});

describe('formatArguments', () => {
  it('joins mixed console arguments with spaces', () => {
    expect(formatArguments(['count', 3, { ok: true }])).toBe(
      'count 3 {"ok":true}'
    );
  });
});
