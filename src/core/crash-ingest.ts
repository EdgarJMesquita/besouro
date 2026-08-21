/**
 * Recovering native crashes from the previous launch.
 *
 * A native crash — an uncaught Kotlin/Java exception, a Swift `fatalError`, a
 * memory fault — takes the process down with the JS thread inside it. There is no
 * bridge call to make and no flush to run, not even the blocking one the JS crash
 * path uses (`./capture.ts`), so the crash cannot be captured while it happens.
 * The native handlers instead append a record to a spool file
 * (`android/CrashCapture.kt`, `ios/BesouroCrashCapture.mm`), and this module
 * reads it back on the next launch and turns each record into a `crash` console
 * row **under the session that died** — which the drawer already surfaces, marked
 * `crashed`, in Session History.
 *
 * The format is line-oriented text rather than JSON for one reason: the iOS signal
 * handler can only use async-signal-safe calls, and `backtrace_symbols_fd` writes
 * frames straight to the file descriptor. A JSON encoder would have to allocate.
 *
 *     --- crash
 *     session=1t3k9a-4-x8d2f1
 *     platform=ios
 *     time=1754500000000
 *     name=SIGSEGV
 *     message=Segmentation fault: 11
 *     stack
 *     0   MyApp   0x0000000104a2c1f0 foo + 44
 *     --- end
 *
 * Parsing is deliberately forgiving. The writer is a crash handler that can be
 * killed mid-write — by the very signal it is reporting, or by a second crash — so
 * a truncated trailing block is normal, not corruption. Unknown keys are ignored
 * so the native side can add one without a coordinated release.
 */

import NativeBesouro from '../native/NativeBesouro';
import { captureEvent, createEventId } from './capture';
import { truncateToBytes } from './truncate';
import type { ConsoleEvent } from './types';

/** Written by the native handlers; see the module note. */
const CRASH_FILE = 'pending-crash.log';

const BLOCK_START = '--- crash';
const BLOCK_END = '--- end';

/**
 * Cap on the whole row — summary *and* trace, since they share `message`. 50 KB,
 * matching the JS-side error cap: a native trace cut short is usually cut above the
 * frame that explains the crash.
 */
const MAX_MESSAGE_BYTES = 50_000;

/** One recovered native crash, before it becomes a console event. */
export interface PendingCrash {
  sessionId: string;
  timestamp: number;
  /** Exception class or signal name — `java.lang.IllegalStateException`, `SIGSEGV`. */
  name: string;
  message: string;
  /** Java stack trace or native backtrace; empty when the writer was cut short. */
  stack: string;
  platform: string;
  /**
   * The crashing thread, as logcat names it in `FATAL EXCEPTION: <thread>`.
   *
   * Android only — empty on iOS, where the signal handler has no async-signal-safe
   * way to read a thread name. Empty rather than guessed: a wrong thread name is
   * worse than none.
   */
  thread: string;
}

/**
 * Parse the spool file's contents. Records missing a session id or a timestamp are
 * dropped: without them a row has nowhere to attach and no place in the timeline,
 * which is exactly the shape a half-written trailing block takes.
 */
export function parsePendingCrashes(text: string): PendingCrash[] {
  const crashes: PendingCrash[] = [];
  let current: Partial<PendingCrash> | null = null;
  let stack: string[] | null = null;

  const finish = (): void => {
    if (current && current.sessionId && current.timestamp) {
      crashes.push({
        sessionId: current.sessionId,
        timestamp: current.timestamp,
        name: current.name ?? '',
        message: current.message ?? '',
        stack: (stack ?? []).join('\n').trim(),
        platform: current.platform ?? '',
        thread: current.thread ?? '',
      });
    }
    current = null;
    stack = null;
  };

  for (const line of text.split('\n')) {
    if (line === BLOCK_START) {
      // No `finish()` guard for a missing BLOCK_END: a block interrupted by the
      // next one is a crash that died mid-write, and whatever it managed to say
      // is still worth keeping.
      finish();
      current = {};
      continue;
    }
    if (!current) continue;
    if (line === BLOCK_END) {
      finish();
      continue;
    }
    // Everything after the `stack` marker is stack, verbatim — a backtrace line
    // can contain anything, including `=`.
    if (stack) {
      stack.push(line);
      continue;
    }
    if (line === 'stack') {
      stack = [];
      continue;
    }

    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    switch (key) {
      case 'session':
        current.sessionId = value;
        break;
      case 'time': {
        const parsed = Number.parseInt(value, 10);
        if (Number.isFinite(parsed) && parsed > 0) current.timestamp = parsed;
        break;
      }
      case 'name':
        current.name = value;
        break;
      case 'message':
        current.message = value;
        break;
      case 'platform':
        current.platform = value;
        break;
      case 'thread':
        current.thread = value;
        break;
      default:
        // Unknown key from a newer native side — ignore rather than fail.
        break;
    }
  }
  finish();

  return crashes;
}

/**
 * The console row a recovered crash becomes.
 *
 * The stack is folded into `message` rather than kept in the `stack` column: the
 * Console tab renders text and nothing else — no detail view — so a stack left in
 * a column no query selects is a stack nobody sees. One field, one copy, and the
 * row's "show more" expands into the whole trace.
 */
export function crashToEvent(crash: PendingCrash): ConsoleEvent {
  const { text, truncated } = truncateToBytes(
    crashText(crash),
    MAX_MESSAGE_BYTES
  );
  return {
    id: createEventId(),
    sessionId: crash.sessionId,
    timestamp: crash.timestamp,
    kind: 'console',
    level: 'crash',
    message: text,
    messageTruncated: truncated,
    // `fatal` is deliberately unset: it exists to tell RN's fatal and non-fatal
    // uncaught errors apart, and a native crash is only ever the former. Setting
    // it would put a FATAL badge next to a CRASH pill that already says so.
  };
}

/**
 * The crash as logcat would print it: the exception line, then the frames.
 *
 * Android's `Throwable.stackTraceToString()` *is* logcat's body — it already opens
 * with `<class>: <message>` and continues with `\tat …`, `Caused by:` chains and
 * all. So the trace is passed through untouched and only the thread is added, in
 * the brackets that stand in for logcat's `FATAL EXCEPTION: <thread>` header.
 * Reformatting it would only make it less like the thing it is quoting.
 *
 * iOS backtraces have no such header line — `backtrace_symbols_fd` writes frames
 * only — so there the summary is prepended.
 */
function crashText(crash: PendingCrash): string {
  const summary = crash.message
    ? `${crash.name}: ${crash.message}`
    : crash.name;
  const prefix = crash.thread ? `[${crash.thread}] ` : '';

  if (!crash.stack) return prefix + summary;
  // Android's trace repeats the summary as its first line; keep the trace's copy
  // rather than printing it twice.
  const body = crash.stack.startsWith(summary)
    ? crash.stack
    : `${summary}\n${crash.stack}`;
  return prefix + body;
}

/**
 * Read the spool file, capture what it holds, and delete it.
 *
 * Best-effort throughout: nothing here may keep `init()` from finishing. The file
 * is deleted whatever the records looked like — an unparseable one will not parse
 * on the next launch either, and leaving it would replay the same failure forever.
 *
 * Ordering matters at the call site: this must run **after** persistence is ready
 * (the rows have to reach the queue's sink) and **before** old sessions are
 * pruned, so a crash row is never written to a session that is about to be
 * evicted. Returns how many crashes were recovered.
 */
export async function ingestPendingCrashes(): Promise<number> {
  const native = NativeBesouro;
  if (!native) return 0;

  let contents: string | null = null;
  try {
    contents = await native.readFile(CRASH_FILE);
  } catch {
    // No file is the overwhelmingly common case — most launches follow a clean
    // exit — and an unreadable one is not worth reporting to a devtool's user.
    return 0;
  }
  if (!contents) return 0;

  let recovered = 0;
  try {
    for (const crash of parsePendingCrashes(contents)) {
      captureEvent(crashToEvent(crash));
      recovered += 1;
    }
  } finally {
    try {
      await native.deleteFile(CRASH_FILE);
    } catch {
      // If the delete fails the records replay next launch. Their ids are fresh
      // each time, so that would duplicate rows rather than collide — accepted:
      // a delete that fails against app-private storage means something is wrong
      // that dropping a crash report would only hide.
    }
  }

  return recovered;
}
