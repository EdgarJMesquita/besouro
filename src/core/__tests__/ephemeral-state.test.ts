import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// The store is a module-level Map, so re-require after resetModules gives each
// test a clean slate.
function loadStore() {
  return require('../ephemeral-state') as typeof import('../ephemeral-state');
}

describe('ephemeral-state', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('returns the fallback for an unset key', () => {
    const { getEphemeral } = loadStore();
    expect(getEphemeral('missing', null)).toBeNull();
  });

  it('round-trips a value and keeps it across re-reads', () => {
    const { getEphemeral, setEphemeral } = loadStore();
    setEphemeral('network.selectedId', 'abc');
    expect(getEphemeral('network.selectedId', null)).toBe('abc');
    // A second read still sees it — it survives the surface being torn down.
    expect(getEphemeral('network.selectedId', null)).toBe('abc');
  });

  it('keeps distinct keys independent', () => {
    const { getEphemeral, setEphemeral } = loadStore();
    setEphemeral('a', 1);
    setEphemeral('b', 2);
    expect(getEphemeral('a', 0)).toBe(1);
    expect(getEphemeral('b', 0)).toBe(2);
  });

  it('preserves object references (e.g. a selected entry)', () => {
    const { getEphemeral, setEphemeral } = loadStore();
    const entry = { name: 'a.txt', path: '/docs/a.txt' };
    setEphemeral('fileSystem.selectedFile', entry);
    expect(getEphemeral('fileSystem.selectedFile', null)).toBe(entry);
  });

  it('supports functional updates against the stored value', () => {
    const { getEphemeral, setEphemeral } = loadStore();
    setEphemeral('fileSystem.pathStack', ['/a']);
    const prev = getEphemeral<string[]>('fileSystem.pathStack', []);
    setEphemeral('fileSystem.pathStack', [...prev, '/a/b']);
    expect(getEphemeral('fileSystem.pathStack', [])).toEqual(['/a', '/a/b']);
  });

  it('notifies subscribers on change but not on an identical re-set', () => {
    const { setEphemeral, subscribeEphemeral } = loadStore();
    const listener = jest.fn();
    const unsubscribe = subscribeEphemeral(listener);

    setEphemeral('k', 'v');
    setEphemeral('k', 'v');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
