/**
 * Crash-ingest tests. The parser's job is to be *forgiving*: its input is written
 * by a handler that can be killed mid-write, by the very crash it is reporting.
 * Most of these cases are about what a half-written file should still yield.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { parsePendingCrashes, crashToEvent } from '../crash-ingest';
import type { ConsoleEvent } from '../types';

const NATIVE_PATH = '../../native/NativeBesouro';

function block(lines: string[]): string {
  return ['--- crash', ...lines, '--- end', ''].join('\n');
}

const ANDROID_CRASH = block([
  'session=s1',
  'platform=android',
  'time=1754500000000',
  'thread=main',
  'name=java.lang.IllegalStateException',
  'message=bubble is not attached',
  'stack',
  'java.lang.IllegalStateException: bubble is not attached',
  '\tat com.besouro.BubbleController.mount(BubbleController.kt:41)',
]);

describe('parsePendingCrashes', () => {
  it('reads a complete record', () => {
    const [crash] = parsePendingCrashes(ANDROID_CRASH);

    expect(crash).toMatchObject({
      sessionId: 's1',
      platform: 'android',
      timestamp: 1754500000000,
      thread: 'main',
      name: 'java.lang.IllegalStateException',
      message: 'bubble is not attached',
    });
    expect(crash?.stack).toContain('BubbleController.kt:41');
  });

  it('reads every record when a crash loop appended several', () => {
    const second = block([
      'session=s2',
      'platform=ios',
      'time=1754500001000',
      'name=SIGSEGV',
      'message=invalid memory access',
      'stack',
      '0   MyApp   0x0000000104a2c1f0 foo + 44',
    ]);

    const crashes = parsePendingCrashes(ANDROID_CRASH + second);

    expect(crashes.map((crash) => crash.sessionId)).toEqual(['s1', 's2']);
    expect(crashes[1]?.name).toBe('SIGSEGV');
  });

  it('keeps a trailing record the writer never finished', () => {
    // Killed after the headers, before `--- end`: no stack, but the name and
    // message are exactly what the developer needs.
    const truncated =
      ANDROID_CRASH +
      [
        '--- crash',
        'session=s2',
        'time=1754500002000',
        'name=SIGABRT',
        '',
      ].join('\n');

    const crashes = parsePendingCrashes(truncated);

    expect(crashes).toHaveLength(2);
    expect(crashes[1]).toMatchObject({ sessionId: 's2', name: 'SIGABRT' });
    expect(crashes[1]?.stack).toBe('');
  });

  it('keeps a record a second crash interrupted', () => {
    // A new block opening without the previous one closing — the first crash
    // died mid-write and the handler re-entered for the next.
    const interrupted =
      ['--- crash', 'session=s1', 'time=1', 'name=SIGSEGV'].join('\n') +
      '\n' +
      block(['session=s2', 'time=2', 'name=SIGBUS']);

    expect(parsePendingCrashes(interrupted).map((c) => c.name)).toEqual([
      'SIGSEGV',
      'SIGBUS',
    ]);
  });

  it('drops a record with no session or no timestamp — it has nowhere to go', () => {
    const orphan = block(['time=1754500000000', 'name=SIGSEGV']);
    const undated = block(['session=s1', 'name=SIGSEGV']);

    expect(parsePendingCrashes(orphan)).toEqual([]);
    expect(parsePendingCrashes(undated)).toEqual([]);
  });

  it('takes stack lines verbatim, including ones containing "="', () => {
    const crash = parsePendingCrashes(
      block([
        'session=s1',
        'time=1',
        'name=SIGSEGV',
        'stack',
        '0   MyApp   0x104a2c1f0 operator=(Foo const&) + 12',
      ])
    )[0];

    expect(crash?.stack).toBe(
      '0   MyApp   0x104a2c1f0 operator=(Foo const&) + 12'
    );
  });

  it('ignores a key it does not know, so native can add one unilaterally', () => {
    const crash = parsePendingCrashes(
      block(['session=s1', 'time=1', 'name=SIGSEGV', 'build=1.4.2-rc1'])
    )[0];

    expect(crash).toMatchObject({ sessionId: 's1', name: 'SIGSEGV' });
  });

  it('yields nothing for an empty or garbage file', () => {
    expect(parsePendingCrashes('')).toEqual([]);
    expect(parsePendingCrashes('not a crash file at all\n')).toEqual([]);
  });
});

describe('crashToEvent', () => {
  const crash = {
    sessionId: 's1',
    timestamp: 1754500000000,
    name: 'SIGSEGV',
    message: 'invalid memory access',
    stack: '0   MyApp   0x104a2c1f0 foo + 44',
    platform: 'ios',
    // iOS records no thread — see PendingCrash.
    thread: '',
  };

  it('becomes a console row on the session that died', () => {
    const event = crashToEvent(crash);

    expect(event).toMatchObject({
      kind: 'console',
      level: 'crash',
      sessionId: 's1',
      // Not the launch that recovered it — the crash's own moment.
      timestamp: 1754500000000,
    });
  });

  it('carries the trace in `message`, the only field the tab renders', () => {
    const event = crashToEvent(crash);

    // iOS backtraces have no header line of their own, so the summary leads.
    expect(event.message).toBe(
      'SIGSEGV: invalid memory access\n0   MyApp   0x104a2c1f0 foo + 44'
    );
    expect(event.stack).toBeUndefined();
  });

  it('passes an Android trace through as logcat prints it', () => {
    const stack = [
      'java.lang.RuntimeException: boom',
      '\tat besouro.example.MainActivity.onCreate(MainActivity.kt:27)',
      '\tat android.os.Handler.handleCallback(Handler.java:958)',
    ].join('\n');

    const event = crashToEvent({
      ...crash,
      thread: 'main',
      name: 'java.lang.RuntimeException',
      message: 'boom',
      stack,
      platform: 'android',
    });

    // The trace already opens with the exception line — it is not repeated, and
    // the frames are untouched. Only the thread bracket is added, standing in for
    // logcat's `FATAL EXCEPTION: <thread>` header.
    expect(event.message).toBe(`[main] ${stack}`);
  });

  it('leads with the crashing thread when there is one', () => {
    const event = crashToEvent({
      ...crash,
      thread: 'OkHttp Dispatcher',
      name: 'java.lang.IllegalStateException',
      message: 'closed',
      stack: '',
    });

    expect(event.message).toBe(
      '[OkHttp Dispatcher] java.lang.IllegalStateException: closed'
    );
  });

  it('omits the bracket entirely on iOS, which has no thread to report', () => {
    expect(crashToEvent({ ...crash, stack: '' }).message).toBe(
      'SIGSEGV: invalid memory access'
    );
  });

  it('leaves `fatal` unset, so CRASH is not badged FATAL as well', () => {
    // The badge stays where it earns its place: on JS `uncaught` rows, whose
    // global handler fires for non-fatal errors too.
    expect(crashToEvent(crash).fatal).toBeUndefined();
  });

  it('uses the name alone when there is no message', () => {
    expect(crashToEvent({ ...crash, message: '', stack: '' }).message).toBe(
      'SIGSEGV'
    );
  });
});

describe('ingestPendingCrashes', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function load() {
    return require('../crash-ingest') as typeof import('../crash-ingest');
  }

  function mockNative(native: unknown) {
    jest.doMock(NATIVE_PATH, () => ({ __esModule: true, default: native }));
  }

  /** Records what capture hands to persistence. */
  function recordSink(): ConsoleEvent[] {
    const events: ConsoleEvent[] = [];
    // Reaching past `../capture` on purpose: attaching a sink is internal to the
    // layer, so only `startCapture` exposes it publicly.
    const record =
      require('../capture/record') as typeof import('../capture/record');
    record.setEventSink({
      add: (event: unknown) => events.push(event as ConsoleEvent),
    } as never);
    return events;
  }

  it('captures each record and deletes the file', async () => {
    const deleteFile = jest.fn(async () => {});
    mockNative({
      readFile: async () => ANDROID_CRASH,
      deleteFile,
    });
    const events = recordSink();

    await expect(load().ingestPendingCrashes()).resolves.toBe(1);

    expect(events[0]).toMatchObject({ level: 'crash', sessionId: 's1' });
    expect(deleteFile).toHaveBeenCalledWith('pending-crash.log');
  });

  it('does nothing when there is no spool file — the common case', async () => {
    const deleteFile = jest.fn(async () => {});
    mockNative({ readFile: async () => null, deleteFile });
    const events = recordSink();

    await expect(load().ingestPendingCrashes()).resolves.toBe(0);

    expect(events).toEqual([]);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('deletes an unparseable file instead of replaying it forever', async () => {
    const deleteFile = jest.fn(async () => {});
    mockNative({ readFile: async () => 'garbage', deleteFile });

    await expect(load().ingestPendingCrashes()).resolves.toBe(0);

    expect(deleteFile).toHaveBeenCalledWith('pending-crash.log');
  });

  it('survives a read failure without failing init', async () => {
    mockNative({
      readFile: async () => {
        throw new Error('unreadable');
      },
      deleteFile: async () => {},
    });

    await expect(load().ingestPendingCrashes()).resolves.toBe(0);
  });

  it('is a no-op without the native module', async () => {
    mockNative(null);
    await expect(load().ingestPendingCrashes()).resolves.toBe(0);
  });
});
