import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { warn } from '../warn';

type ConsoleHolder = { console?: { warn?: (...args: unknown[]) => void } };

const globals = globalThis as ConsoleHolder;
const originalConsole = globals.console;

afterEach(() => {
  globals.console = originalConsole;
});

describe('core/warn', () => {
  it('prefixes the message so the source is obvious in a shared console', () => {
    const spy = jest.fn();
    globals.console = { warn: spy };

    warn('native module not found');

    expect(spy).toHaveBeenCalledWith('[besouro] native module not found');
  });

  it('reads console off globalThis at call time, so a patched warn is used', () => {
    // The console inspector replaces `console.warn` in place after this module
    // is imported; binding it at import would send warnings to the original and
    // bypass capture.
    const first = jest.fn();
    globals.console = { warn: first };
    warn('before');

    const second = jest.fn();
    globals.console = { warn: second };
    warn('after');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith('[besouro] after');
  });

  it('does not throw when console.warn is missing', () => {
    globals.console = {};
    expect(() => warn('no warn method')).not.toThrow();
  });

  it('does not throw when there is no console at all', () => {
    delete globals.console;
    expect(() => warn('no console')).not.toThrow();
  });
});
