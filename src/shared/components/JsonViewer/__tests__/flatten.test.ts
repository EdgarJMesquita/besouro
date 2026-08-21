import { describe, it, expect } from '@jest/globals';
import { flattenJson, computeVisibleLines, flashedLineIds } from '../flatten';

describe('flattenJson', () => {
  it('flattens a primitive to a single line', () => {
    const lines = flattenJson(42);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: 'primitive',
      valueText: '42',
      valueType: 'number',
    });
  });

  it('emits open/close lines around object entries with paths', () => {
    const lines = flattenJson({ name: 'ada', age: 36 });
    expect(lines[0]).toMatchObject({ kind: 'open', bracket: '{' });
    expect(lines.at(-1)).toMatchObject({ kind: 'close', bracket: '}' });

    const nameLine = lines.find((line) => line.keyText === 'name');
    expect(nameLine).toMatchObject({
      kind: 'key-value',
      valueText: '"ada"',
      valueType: 'string',
      path: 'name',
    });
  });

  it('builds array index paths', () => {
    const lines = flattenJson({ items: [{ id: 7 }] });
    const idLine = lines.find((line) => line.keyText === 'id');
    expect(idLine?.path).toBe('items[0].id');
  });

  it('marks trailing commas on all but the last sibling', () => {
    const lines = flattenJson({ a: 1, b: 2 });
    const aLine = lines.find((line) => line.keyText === 'a');
    const bLine = lines.find((line) => line.keyText === 'b');
    expect(aLine?.hasTrailingComma).toBe(true);
    expect(bLine?.hasTrailingComma).toBe(false);
  });

  it('renders empty containers inline and non-collapsible', () => {
    const lines = flattenJson({ empty: [] });
    const emptyLine = lines.find((line) => line.keyText === 'empty');
    expect(emptyLine).toMatchObject({
      kind: 'key-value',
      valueText: '[]',
      collapsible: false,
    });
  });

  it('records the matching close index on open lines', () => {
    const lines = flattenJson({ nested: { a: 1 } });
    const openLine = lines.find((line) => line.keyText === 'nested');
    expect(openLine?.endIndex).toBeDefined();
    expect(lines[openLine!.endIndex!]).toMatchObject({ kind: 'close' });
  });
});

describe('computeVisibleLines', () => {
  it('returns every line when nothing is collapsed', () => {
    const lines = flattenJson({ a: { b: 1 } });
    expect(computeVisibleLines(lines, new Set())).toHaveLength(lines.length);
  });

  it('skips a collapsed node and its descendants through the close', () => {
    const lines = flattenJson({ a: { b: 1, c: 2 }, d: 3 });
    const openLine = lines.find((line) => line.keyText === 'a');
    const visible = computeVisibleLines(lines, new Set([openLine!.id]));
    // The collapsed open line is still shown, but its children and close are gone.
    expect(visible.some((line) => line.keyText === 'b')).toBe(false);
    expect(visible.some((line) => line.keyText === 'c')).toBe(false);
    expect(visible.some((line) => line.keyText === 'a')).toBe(true);
    expect(visible.some((line) => line.keyText === 'd')).toBe(true);
  });
});

describe('flashedLineIds', () => {
  /** The lines a set of ids covers, named by key where they have one. */
  function keysOf(lines: ReturnType<typeof flattenJson>, ids: Set<string>) {
    return lines.filter((line) => ids.has(line.id)).map((line) => line.keyText);
  }

  it('tints the whole subtree of a changed container', () => {
    // A diff reports the shallowest differing path, so a replaced object arrives
    // as `cart` alone. Tinting only that line highlights `"cart": {` and leaves
    // every value inside it plain, which reads as the key having changed.
    const lines = flattenJson({ cart: { items: 2, total: 10 }, user: 'ada' });

    const ids = flashedLineIds(lines, new Set(['cart']));

    expect(keysOf(lines, ids)).toEqual(['cart', 'items', 'total']);
    // Through the matching close, so the closing brace is tinted with its block.
    expect(lines.filter((line) => ids.has(line.id))).toHaveLength(4);
    expect(keysOf(lines, ids)).not.toContain('user');
  });

  it('tints one line for a changed leaf, which already holds its value', () => {
    const lines = flattenJson({ counter: { value: 1 } });

    const ids = flashedLineIds(lines, new Set(['counter.value']));

    expect(keysOf(lines, ids)).toEqual(['value']);
  });

  it('ignores a path with no matching line', () => {
    // A value `JSON.stringify` drops has a changed path but never a line.
    const lines = flattenJson({ a: 1 });
    expect(flashedLineIds(lines, new Set(['missing'])).size).toBe(0);
  });
});
