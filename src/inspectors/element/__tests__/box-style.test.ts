/**
 * Box-style resolution: every spelling RN accepts for a box property has to land
 * on the right edges, and an undeclared property has to stay undeclared so the
 * diagram knows to leave the ring out.
 */

import { describe, it, expect, jest } from '@jest/globals';

// These tests run in a plain node environment (see jest.config.js), so the one
// thing the module under test takes from react-native is stubbed rather than
// pulling the real package in. LTR, which is what the assertions below assume.
jest.mock('react-native', () => ({ I18nManager: { isRTL: false } }));

import { resolveBoxStyle } from '../utils/box-style';

describe('resolveBoxStyle', () => {
  it('returns null when the style declares nothing', () => {
    expect(resolveBoxStyle('padding', { margin: 4, width: 10 })).toBeNull();
  });

  it('spreads the shorthand across all four edges', () => {
    expect(resolveBoxStyle('padding', { padding: 8 })).toEqual({
      top: 8,
      right: 8,
      bottom: 8,
      left: 8,
    });
  });

  it('lets the axis pairs override the shorthand', () => {
    expect(
      resolveBoxStyle('margin', {
        margin: 4,
        marginHorizontal: 12,
        marginVertical: 2,
      })
    ).toEqual({ top: 2, right: 12, bottom: 2, left: 12 });
  });

  it('lets an explicit side win over the axis it belongs to', () => {
    expect(
      resolveBoxStyle('padding', { paddingVertical: 6, paddingTop: 20 })
    ).toEqual({ top: 20, right: 0, bottom: 6, left: 0 });
  });

  it('maps start/end to left/right in an LTR app', () => {
    expect(
      resolveBoxStyle('padding', { paddingStart: 16, paddingEnd: 4 })
    ).toEqual({ top: 0, right: 4, bottom: 0, left: 16 });
  });

  it('keeps non-numeric values as written', () => {
    expect(resolveBoxStyle('margin', { marginLeft: 'auto' })).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 'auto',
    });
  });

  it('ignores values that are not layout values', () => {
    expect(resolveBoxStyle('padding', { padding: null })).toBeNull();
  });
});
