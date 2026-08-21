/**
 * A session's tabs are decided against a set recorded by a *past* run of the app,
 * so the rules that matter are the ones about disagreement: an inspector switched
 * off since, one enabled since, one this version no longer knows about.
 */

import { describe, it, expect } from '@jest/globals';
import { sessionTabs } from '../session-tabs';
import type { Inspector } from '../types';

const ENABLED: Inspector[] = ['network', 'console', 'element'];

describe('sessionTabs', () => {
  it('leaves the enabled set alone when the session recorded a subset of it', () => {
    expect(sessionTabs(ENABLED, ['console'])).toEqual([
      'network',
      'console',
      'element',
    ]);
  });

  it('keeps a tab for an inspector that has been switched off since', () => {
    // The whole point: the session's network rows are still on disk, so the tab
    // that shows them has to survive network being disabled.
    expect(sessionTabs(['console'], ['network', 'console'])).toEqual([
      'console',
      'network',
    ]);
  });

  it('keeps a tab for an inspector enabled since the session ran', () => {
    // Empty, but honest: it was recording nothing, and saying so beats a strip
    // whose shape changes as you page through history.
    expect(sessionTabs(ENABLED, ['console'])).toContain('network');
  });

  it('treats an unknown recorded set as the enabled one', () => {
    // A session persisted before the set was recorded — unknown, not none.
    expect(sessionTabs(ENABLED, undefined)).toEqual(ENABLED);
    expect(sessionTabs(ENABLED, [])).toEqual(ENABLED);
  });

  it('drops recorded ids this version has never heard of', () => {
    expect(sessionTabs(['console'], ['bogus' as Inspector, 'network'])).toEqual(
      ['console', 'network']
    );
  });

  it('lists a repeated recorded entry once', () => {
    expect(sessionTabs(['console'], ['network', 'network'])).toEqual([
      'console',
      'network',
    ]);
  });

  it('falls back to the recorded set when nothing is enabled', () => {
    expect(sessionTabs([], ['network', 'console'])).toEqual([
      'network',
      'console',
    ]);
  });

  it('does not mutate either input', () => {
    const enabled: Inspector[] = ['console'];
    const recorded: Inspector[] = ['network'];
    sessionTabs(enabled, recorded);
    expect(enabled).toEqual(['console']);
    expect(recorded).toEqual(['network']);
  });
});
