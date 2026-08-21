import { describe, it, expect } from '@jest/globals';
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  clampFrame,
  defaultFrame,
  denormalizeFrame,
  isStoredFrame,
  normalizeFrame,
  type Frame,
  type ScreenBounds,
} from '../mini-window-geometry';

/** A phone-shaped screen with a status bar and a home indicator. */
const phone: ScreenBounds = { width: 400, height: 800, top: 48, bottom: 24 };

describe('clampFrame', () => {
  it('keeps the top edge below the status bar', () => {
    // The strip under the status bar takes touches, so a panel released there
    // keeps its header but loses every way to grab it.
    const clamped = clampFrame(
      { x: 100, y: 0, width: 240, height: 320 },
      phone
    );
    expect(clamped.y).toBe(phone.top);
  });

  it('keeps the bottom edge above the home indicator', () => {
    const clamped = clampFrame(
      { x: 0, y: 700, width: 240, height: 320 },
      phone
    );
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(
      phone.height - phone.bottom
    );
  });

  it('allows the full width of the screen', () => {
    const clamped = clampFrame(
      { x: 0, y: 100, width: 999, height: 320 },
      phone
    );
    expect(clamped.width).toBe(phone.width);
    expect(clamped.x).toBe(0);
  });

  it('refuses a panel too small to hold its own header', () => {
    const clamped = clampFrame({ x: 0, y: 100, width: 10, height: 10 }, phone);
    expect(clamped.width).toBe(MIN_WIDTH);
    expect(clamped.height).toBe(MIN_HEIGHT);
  });
});

describe('defaultFrame', () => {
  it('opens in the upper-right, clear of the status bar', () => {
    const frame = defaultFrame(phone);
    expect(frame.y).toBeGreaterThanOrEqual(phone.top);
    expect(frame.x + frame.width).toBeLessThanOrEqual(phone.width);
  });

  it('fits a screen narrower than the default width', () => {
    const narrow: ScreenBounds = { ...phone, width: 200 };
    const frame = defaultFrame(narrow);
    expect(frame.width).toBeLessThanOrEqual(narrow.width);
    expect(frame.x).toBeGreaterThanOrEqual(0);
  });
});

describe('normalize / denormalize', () => {
  it('round-trips a frame on the same screen', () => {
    const frame: Frame = { x: 120, y: 300, width: 240, height: 320 };
    const restored = denormalizeFrame(normalizeFrame(frame, phone), phone);
    expect(restored.x).toBeCloseTo(frame.x);
    expect(restored.y).toBeCloseTo(frame.y);
    expect(restored.width).toBe(frame.width);
    expect(restored.height).toBe(frame.height);
  });

  it('keeps a panel parked at the right edge at the right edge on a narrower screen', () => {
    // The point of storing a ratio rather than a coordinate: "hard right" has to
    // survive the trip to a different device.
    const wide: ScreenBounds = { ...phone, width: 600 };
    const stored = normalizeFrame(
      { x: 600 - 240, y: 100, width: 240, height: 320 },
      wide
    );
    const restored = denormalizeFrame(stored, phone);
    expect(restored.x + restored.width).toBe(phone.width);
  });

  it('lands a frame stored on a larger screen back on this one', () => {
    const tablet: ScreenBounds = {
      width: 900,
      height: 1400,
      top: 24,
      bottom: 0,
    };
    const stored = normalizeFrame(
      { x: 500, y: 900, width: 700, height: 900 },
      tablet
    );
    const restored = denormalizeFrame(stored, phone);
    expect(restored.x).toBeGreaterThanOrEqual(0);
    expect(restored.x + restored.width).toBeLessThanOrEqual(phone.width);
    expect(restored.y).toBeGreaterThanOrEqual(phone.top);
    expect(restored.y + restored.height).toBeLessThanOrEqual(
      phone.height - phone.bottom
    );
  });

  it('pins a full-width panel to the origin rather than dividing by zero', () => {
    const stored = normalizeFrame(
      { x: 0, y: phone.top, width: phone.width, height: 320 },
      phone
    );
    expect(stored.xRatio).toBe(0);
    expect(denormalizeFrame(stored, phone).x).toBe(0);
  });

  it('survives a rotation', () => {
    const landscape: ScreenBounds = {
      width: 800,
      height: 400,
      top: 24,
      bottom: 24,
    };
    const stored = normalizeFrame(
      { x: 160, y: 100, width: 240, height: 320 },
      phone
    );
    const restored = denormalizeFrame(stored, landscape);
    expect(restored.y).toBeGreaterThanOrEqual(landscape.top);
    expect(restored.y + restored.height).toBeLessThanOrEqual(
      landscape.height - landscape.bottom
    );
  });
});

describe('isStoredFrame', () => {
  it('accepts what normalizeFrame writes', () => {
    expect(
      isStoredFrame(
        normalizeFrame({ x: 10, y: 60, width: 240, height: 320 }, phone)
      )
    ).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['a partial frame', { xRatio: 0.5, yRatio: 0.5 }],
    ['NaN', { xRatio: NaN, yRatio: 0, width: 1, height: 1 }],
  ])('rejects %s', (_label: string, value: unknown) => {
    expect(isStoredFrame(value)).toBe(false);
  });
});
