/** What an atom's history row says. */

import { describe, it, expect } from '@jest/globals';
import { changeSummary } from '../utils/change-summary';
import type { JotaiEvent } from '../../../core/types';

function event(overrides: Partial<JotaiEvent> = {}): JotaiEvent {
  return {
    id: 'e1',
    sessionId: 's1',
    timestamp: 1,
    kind: 'jotai',
    atomId: 'jotai-1',
    atomName: 'cart',
    isInitial: false,
    isReload: false,
    changedKeys: ['items', 'total'],
    preview: '{"items":["SKU-1"],"total":10}',
    valueTruncated: false,
    ...overrides,
  };
}

describe('changeSummary', () => {
  it('names what moved, not the whole value', () => {
    // Successive previews of a growing object are nearly identical, so the value
    // is the one thing that cannot tell one history row from the next.
    expect(changeSummary(event())).toBe('items, total');
  });

  it('falls back to the value for a primitive atom, which has no keys', () => {
    // `atom(0)` would otherwise render a blank row.
    expect(changeSummary(event({ preview: '42', changedKeys: [] }))).toBe('42');
  });

  it('shows the starting value on the initial row, and only that', () => {
    // The badge says it is a starting value (`shared/components/BaselinePill`);
    // naming it here too left the column reading `Initial state · 0` among bare
    // `0`, `1`, `2`. The keys are skipped for the same reason the value wins on a
    // primitive atom: this is the only place the atom's starting value appears.
    expect(
      changeSummary(
        event({ isInitial: true, preview: '0', changedKeys: ['items'] })
      )
    ).toBe('0');
  });
});
