/**
 * Which inspectors a past session can replay.
 *
 * The rule is structural — `Inspector` minus `InspectorKind` — but nothing in the
 * type system enforces the list, so it is asserted here: adding another inspector
 * without deciding which side it falls on should fail a test, not ship a tab that
 * shows live state under a historical header.
 */

import { describe, it, expect } from '@jest/globals';
import {
  BROWSER_INSPECTORS,
  INSPECTOR_ORDER,
  isBrowserInspector,
  recordingInspectors,
} from '../types';
import type { Inspector } from '../types';

const ALL: Inspector[] = [
  'network',
  'websocket',
  'socketio',
  'console',
  'notifications',
  'element',
  'asyncStorage',
  'mmkv',
  'zustand',
  'redux',
  'jotai',
  'fileSystem',
];

describe('INSPECTOR_ORDER', () => {
  it('lists every inspector exactly once', () => {
    // It is the drawer's whole tab strip now that registration order is gone: an
    // inspector missing here is enabled but has no tab, and a duplicate renders
    // twice. `readonly Inspector[]` catches neither.
    expect([...INSPECTOR_ORDER].sort()).toEqual([...ALL].sort());
    expect(new Set(INSPECTOR_ORDER).size).toBe(INSPECTOR_ORDER.length);
  });

  it('puts the browser-class tabs last', () => {
    // A past session drops them (see `recordingInspectors`), so trailing means the
    // strip shortens from the end rather than gapping in the middle.
    const firstBrowser = INSPECTOR_ORDER.findIndex(isBrowserInspector);
    const lastRecording =
      INSPECTOR_ORDER.map(isBrowserInspector).lastIndexOf(false);
    expect(firstBrowser).toBeGreaterThan(lastRecording);
  });
});

describe('browser-class inspectors', () => {
  it('is exactly the set that records no events', () => {
    expect([...BROWSER_INSPECTORS].sort()).toEqual(['element', 'fileSystem']);
  });

  it('classifies every inspector', () => {
    const browsing = ALL.filter(isBrowserInspector);
    const recording = recordingInspectors(ALL);
    expect(browsing.length + recording.length).toBe(ALL.length);
  });
});

describe('recordingInspectors', () => {
  it('drops the browser-class tabs from a past session', () => {
    expect(recordingInspectors(ALL)).not.toContain('element');
    expect(recordingInspectors(ALL)).not.toContain('fileSystem');
  });

  it('keeps every recording inspector, in registration order', () => {
    expect(recordingInspectors(['zustand', 'element', 'network'])).toEqual([
      'zustand',
      'network',
    ]);
  });

  it('returns nothing when only browser-class inspectors are registered', () => {
    // The drawer falls back to its empty state rather than rendering a blank tab bar.
    expect(recordingInspectors(['element', 'fileSystem'])).toEqual([]);
  });
});
