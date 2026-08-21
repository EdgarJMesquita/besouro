/**
 * The two signals lists key off. Counters are module state and monotonic across a
 * test file, so every assertion is a delta rather than an absolute value — which
 * is also how the consumers read them.
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  getClearGeneration,
  getWriteRevision,
  markCleared,
  markWritten,
} from '../inspector-revisions';

describe('write revision', () => {
  it('changes when a flush lands rows for a kind', () => {
    const before = getWriteRevision('console');

    markWritten(new Set(['console']));

    expect(getWriteRevision('console')).not.toBe(before);
  });

  it('changes only for the kinds a flush touched', () => {
    const network = getWriteRevision('network');

    markWritten(new Set(['console']));

    expect(getWriteRevision('network')).toBe(network);
  });

  it('ignores an empty flush', () => {
    const listener = jest.fn();
    // Subscribing through the hook isn't possible outside React; assert via the
    // counter, which is what the hook's snapshot reads.
    const before = getWriteRevision('console');

    markWritten(new Set());

    expect(getWriteRevision('console')).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('clear generation', () => {
  it('changes when a kind is cleared', () => {
    const before = getClearGeneration('network');

    markCleared('network');

    expect(getClearGeneration('network')).not.toBe(before);
  });

  it('leaves other kinds alone when clearing one', () => {
    markWritten(new Set(['console', 'network']));
    const network = getClearGeneration('network');

    markCleared('console');

    expect(getClearGeneration('network')).toBe(network);
  });

  it('clears every seen kind when called without one', () => {
    markWritten(new Set(['console', 'network']));
    const console = getClearGeneration('console');
    const network = getClearGeneration('network');

    markCleared();

    expect(getClearGeneration('console')).not.toBe(console);
    expect(getClearGeneration('network')).not.toBe(network);
  });

  it('does not move the write revision', () => {
    // The two signals mean different things: a clear must shrink the paging
    // window, a write must not. Conflating them would snap a scrolled list back
    // to one page on every captured log line.
    const revision = getWriteRevision('console');

    markCleared('console');

    expect(getWriteRevision('console')).toBe(revision);
  });
});
