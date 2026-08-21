/**
 * Color detection decides which prop rows get a swatch. Both directions matter:
 * a missed color is a lost preview, but a false positive hands RN a
 * `backgroundColor` it can't parse — so ordinary style values (`row`, `100`)
 * have to stay out.
 */

import { describe, it, expect } from '@jest/globals';

import { asColor } from '../utils/color';

describe('asColor', () => {
  it('accepts every hex length RN takes', () => {
    for (const hex of ['#fff', '#ffff', '#3b82f6', '#3b82f680']) {
      expect(asColor(hex)).toBe(hex);
    }
  });

  it('rejects hex of any other length, and non-hex digits', () => {
    for (const text of ['#ff', '#fffff', '#fffffff', '#gggggg', '#']) {
      expect(asColor(text)).toBeNull();
    }
  });

  it('accepts the functional forms, comma- or space-separated', () => {
    for (const text of [
      'rgb(255, 0, 0)',
      'rgba(255, 0, 0, 0.5)',
      'hsl(210 100% 50%)',
      'hsla(210, 100%, 50%, .5)',
      'hwb(210deg 20% 30% / 0.4)',
    ]) {
      expect(asColor(text)).toBe(text);
    }
  });

  it('rejects a functional form whose arguments are not numbers', () => {
    expect(asColor('rgb(red, green, blue)')).toBeNull();
    expect(asColor('url(image.png)')).toBeNull();
    expect(asColor('translate(10, 20)')).toBeNull();
  });

  it('accepts named colors, case-insensitively', () => {
    expect(asColor('rebeccapurple')).toBe('rebeccapurple');
    expect(asColor('DarkSlateGray')).toBe('DarkSlateGray');
    expect(asColor('transparent')).toBe('transparent');
  });

  it('leaves the value as written, trimming only for the check', () => {
    expect(asColor('  #fff  ')).toBe('#fff');
  });

  it('rejects the style values that merely read like words', () => {
    for (const text of ['row', 'bold', 'flex-start', 'center', 'auto', '']) {
      expect(asColor(text)).toBeNull();
    }
  });

  it('rejects non-strings, so a length is never mistaken for a packed color', () => {
    for (const value of [100, 0xff0000, 0, true, null, undefined, {}, []]) {
      expect(asColor(value)).toBeNull();
    }
  });
});
