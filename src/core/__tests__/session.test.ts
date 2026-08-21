import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  startSession,
  adoptSession,
  getCurrentSession,
  installCrashCapture,
  recordUncaughtError,
} from '../session';
import { recordCaptures } from './capture-recorder';
import type { ConsoleEvent } from '../types';

interface GlobalWithErrorUtils {
  ErrorUtils?: {
    getGlobalHandler?: () => ((e: unknown, f?: boolean) => void) | undefined;
    setGlobalHandler?: (h: (e: unknown, f?: boolean) => void) => void;
  };
}

const globals = globalThis as GlobalWithErrorUtils;

/** Records what capture hands to persistence — see capture-recorder. */
const captured = recordCaptures();

function consoleEvents(): ConsoleEvent[] {
  return captured.eventsOf<ConsoleEvent>('console');
}

describe('the recorded inspector set', () => {
  it('is stored on the session it was captured with', () => {
    expect(startSession(['network', 'console']).inspectors).toEqual([
      'network',
      'console',
    ]);
  });

  it('survives being adopted across a reload that changed the config', () => {
    // Metro reloads with network switched off, and the pre-reload session is
    // adopted so its rows stay under one id. Those rows are network rows, so the
    // set they belong to is the union, not the one this launch resolved.
    startSession(['console']);
    const adopted = adoptSession({
      id: 'previous',
      startedAt: 1_000,
      status: 'open',
      inspectors: ['network', 'console'],
    });

    expect(adopted.inspectors).toEqual(['console', 'network']);
    expect(getCurrentSession()?.id).toBe('previous');
  });

  it('is the live one when the adopted session never recorded its own', () => {
    startSession(['console']);
    const adopted = adoptSession({
      id: 'previous',
      startedAt: 1_000,
      status: 'open',
    });
    expect(adopted.inspectors).toEqual(['console']);
  });
});

describe('recordUncaughtError', () => {
  beforeEach(() => {
    captured.reset();
    startSession();
  });

  it('records an uncaught console event carrying the message, stack and fatal flag', () => {
    recordUncaughtError(new TypeError('undefined is not a function'), true);

    const [event] = consoleEvents();
    expect(event?.level).toBe('uncaught');
    expect(event?.message).toBe('TypeError: undefined is not a function');
    expect(event?.stack).toContain('TypeError');
    expect(event?.fatal).toBe(true);
  });

  it('distinguishes non-fatal global errors', () => {
    recordUncaughtError(new Error('recoverable'), false);
    expect(consoleEvents()[0]?.fatal).toBe(false);
  });

  it('handles a thrown non-error', () => {
    recordUncaughtError('just a string', true);

    const [event] = consoleEvents();
    expect(event?.message).toBe('just a string');
    expect(event?.stack).toBeUndefined();
  });
});

describe('installCrashCapture', () => {
  const original = globals.ErrorUtils;

  beforeEach(() => {
    captured.reset();
    startSession();
  });

  afterEach(() => {
    globals.ErrorUtils = original;
  });

  it('records the crash before handing back to RN, which stops the app', () => {
    let handler: ((e: unknown, f?: boolean) => void) | undefined;
    const previous = jest.fn();
    globals.ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h) => {
        handler = h;
      },
    };

    // Mirrors the controller's wiring. The recording is synchronous — there is
    // no turn of the event loop between it and RN's handler below.
    const written: boolean[] = [];
    const eventsAtCrash: number[] = [];
    installCrashCapture((error, isFatal) => {
      written.push(recordUncaughtError(error, isFatal));
      eventsAtCrash.push(consoleEvents().length);
    });

    handler?.(new Error('boom'), true);

    expect(eventsAtCrash).toEqual([1]);
    expect(written).toEqual([true]);
    expect(previous).toHaveBeenCalled();
  });
});
