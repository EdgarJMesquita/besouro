#import "BesouroCrashCapture.h"
#import "BesouroFileStore.h"

#import <errno.h>
#import <execinfo.h>
#import <fcntl.h>
#import <signal.h>
#import <string.h>
#import <sys/stat.h>
#import <time.h>
#import <unistd.h>

// Records a native crash into a spool file the next launch reads back into the
// Console tab (`core/crash-ingest.ts`). Mirrors the Android CrashCapture, but
// almost nothing about the implementation can be shared, because of one
// constraint that shapes the whole file:
//
// **A signal handler may only call async-signal-safe functions.** No Foundation,
// no malloc, no NSString, no snprintf. Anything else risks deadlocking against a
// lock the crashing thread already holds — turning a crash the OS would have
// reported into a hang it won't. So everything a handler needs is prepared *in
// advance*, in `installWithSessionId:`, and the handler itself does nothing but
// `write(2)` and integer formatting into a stack buffer.
//
// Two entry points feed one writer:
//
//  1. NSSetUncaughtExceptionHandler — ObjC exceptions. Runs on a normal thread
//     with Foundation available, but writes through the same signal-safe path so
//     the record format has exactly one implementation.
//  2. sigaction for the fatal signals — Swift `fatalError`, force-unwraps, C++
//     throws, memory faults. This is most real iOS crashes; NSException alone
//     would miss them.
//
// Both chain to whatever was installed before and let the crash proceed, so a
// redbox, Crashlytics/Sentry and the OS crash report are all unaffected.

static NSString *const kCrashFile = @"pending-crash.log";

// ── Prepared state ──────────────────────────────────────────────────────────
// Everything a handler touches, rendered before any crash. `volatile sig_atomic_t`
// for the flags: the only type a handler may read without tearing.

/// Absolute path of the spool file, NUL-terminated. Opened per crash rather than
/// held open, so nothing leaks an fd for the life of the process.
static char sCrashPath[1024] = {0};

/// The `session=<id>\n` line, pre-rendered — a handler cannot build it.
static char sSessionLine[256] = {0};
static size_t sSessionLineLength = 0;

static volatile sig_atomic_t sInstalled = 0;
/// Set while a handler is writing, so a second fatal signal doesn't re-enter and
/// interleave two records into the same file.
static volatile sig_atomic_t sHandling = 0;

static NSUncaughtExceptionHandler *sPreviousExceptionHandler = NULL;

static const int kFatalSignals[] = {SIGSEGV, SIGABRT, SIGBUS,
                                    SIGILL,  SIGFPE,  SIGTRAP};
static const size_t kFatalSignalCount =
    sizeof(kFatalSignals) / sizeof(kFatalSignals[0]);
static struct sigaction sPreviousActions[kFatalSignalCount];

/// Spool cap. A crash loop relaunching into a broken database would otherwise
/// append forever; nothing already in the file is worth keeping over the newest
/// record.
static const off_t kMaxSpoolBytes = 256 * 1024;

/// Backtrace depth. Deep enough to reach through a Swift runtime trap into app
/// code, shallow enough that the write stays one small burst.
static const int kMaxFrames = 64;

// ── Signal-safe primitives ──────────────────────────────────────────────────

/// `write` until the whole buffer is out or it stops making progress. A short
/// write is legal, and a record missing its tail parses as a truncated block —
/// which the JS parser accepts, but only if we don't silently drop the rest.
static void SafeWrite(int fd, const char *bytes, size_t length) {
  size_t written = 0;
  while (written < length) {
    ssize_t result = write(fd, bytes + written, length - written);
    if (result > 0) {
      written += (size_t)result;
      continue;
    }
    if (result < 0 && errno == EINTR) continue;  // interrupted, not failed
    return;
  }
}

static void SafeWriteString(int fd, const char *text) {
  if (text) SafeWrite(fd, text, strlen(text));
}

/// Render a non-negative integer into `buffer` and write it. Hand-rolled because
/// snprintf is not async-signal-safe.
static void SafeWriteInteger(int fd, unsigned long long value) {
  char digits[24];
  size_t index = sizeof(digits);
  if (value == 0) digits[--index] = '0';
  while (value > 0 && index > 0) {
    digits[--index] = (char)('0' + (value % 10));
    value /= 10;
  }
  SafeWrite(fd, digits + index, sizeof(digits) - index);
}

/// Milliseconds since the epoch. `clock_gettime` is async-signal-safe;
/// `gettimeofday` and anything Foundation-shaped is not.
static unsigned long long SafeCurrentMillis(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_REALTIME, &now) != 0) return 0;
  return (unsigned long long)now.tv_sec * 1000ULL +
         (unsigned long long)(now.tv_nsec / 1000000);
}

/// Open the spool for appending, resetting it if it has grown past the cap.
/// Returns -1 when the record cannot be written at all.
static int SafeOpenSpool(void) {
  if (sCrashPath[0] == '\0') return -1;

  int fd = open(sCrashPath, O_WRONLY | O_APPEND | O_CREAT, 0644);
  if (fd < 0) return -1;

  struct stat info;
  if (fstat(fd, &info) == 0 && info.st_size > kMaxSpoolBytes) {
    close(fd);
    // O_TRUNC on the reopen rather than unlink: same result, one syscall, and no
    // window where the path doesn't exist.
    fd = open(sCrashPath, O_WRONLY | O_APPEND | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) return -1;
  }
  return fd;
}

// ── The record ──────────────────────────────────────────────────────────────

/// Write one block. `name` and `message` must be NUL-terminated and free of
/// newlines — the parser reads one header per line. When `frames` is non-NULL the
/// backtrace is written with `backtrace_symbols_fd`, which formats straight to the
/// descriptor without allocating; that is the reason this file writes text rather
/// than JSON.
static void WriteCrashRecord(const char *name,
                             const char *message,
                             void *const *frames,
                             int frameCount) {
  int fd = SafeOpenSpool();
  if (fd < 0) return;

  SafeWriteString(fd, "--- crash\n");
  SafeWrite(fd, sSessionLine, sSessionLineLength);
  SafeWriteString(fd, "platform=ios\n");
  SafeWriteString(fd, "time=");
  SafeWriteInteger(fd, SafeCurrentMillis());
  SafeWriteString(fd, "\nname=");
  SafeWriteString(fd, name);
  SafeWriteString(fd, "\nmessage=");
  SafeWriteString(fd, message);
  SafeWriteString(fd, "\nstack\n");
  if (frames && frameCount > 0) {
    backtrace_symbols_fd(frames, frameCount, fd);
  }
  SafeWriteString(fd, "--- end\n");

  close(fd);
}

/// The signal's name, as a literal — a handler cannot build a string, and
/// `strsignal` is not async-signal-safe.
static const char *SignalName(int signalNumber) {
  switch (signalNumber) {
    case SIGSEGV: return "SIGSEGV";
    case SIGABRT: return "SIGABRT";
    case SIGBUS:  return "SIGBUS";
    case SIGILL:  return "SIGILL";
    case SIGFPE:  return "SIGFPE";
    case SIGTRAP: return "SIGTRAP";
    default:      return "SIGNAL";
  }
}

static const char *SignalDescription(int signalNumber) {
  switch (signalNumber) {
    case SIGSEGV: return "invalid memory access";
    case SIGABRT: return "abort — a runtime trap or an unhandled C++ exception";
    case SIGBUS:  return "bus error — misaligned or unmapped address";
    case SIGILL:  return "illegal instruction";
    case SIGFPE:  return "arithmetic error";
    // Swift's fatalError, force-unwrapping nil and failed preconditions all land
    // here, which makes SIGTRAP the most common of these in practice.
    case SIGTRAP: return "runtime trap — fatalError, a failed precondition, or nil force-unwrap";
    default:      return "fatal signal";
  }
}

// ── Handlers ────────────────────────────────────────────────────────────────

static void HandleFatalSignal(int signalNumber, siginfo_t *info, void *context) {
  if (!sHandling) {
    sHandling = 1;

    void *frames[kMaxFrames];
    // backtrace() walks the stack without allocating; backtrace_symbols() would
    // malloc, which is why the _fd variant does the formatting.
    int frameCount = backtrace(frames, kMaxFrames);
    WriteCrashRecord(SignalName(signalNumber), SignalDescription(signalNumber),
                     frames, frameCount);
  }

  // Restore and re-raise so the crash proceeds exactly as it would have: the
  // previous handler (a crash reporter, say) runs, and failing that the default
  // disposition produces the OS crash report. Without this the process would
  // return into the faulting instruction and loop forever.
  for (size_t i = 0; i < kFatalSignalCount; i++) {
    if (kFatalSignals[i] != signalNumber) continue;
    struct sigaction *previous = &sPreviousActions[i];
    if (previous->sa_flags & SA_SIGINFO) {
      if (previous->sa_sigaction) previous->sa_sigaction(signalNumber, info, context);
      return;
    }
    if (previous->sa_handler && previous->sa_handler != SIG_DFL &&
        previous->sa_handler != SIG_IGN) {
      previous->sa_handler(signalNumber);
      return;
    }
    break;
  }

  signal(signalNumber, SIG_DFL);
  raise(signalNumber);
}

static void HandleUncaughtException(NSException *exception) {
  if (!sHandling) {
    sHandling = 1;

    // Foundation is usable here (this is not a signal context), but the record
    // still goes out through the signal-safe writer so there is one format and
    // one code path. Only the conversion to C strings differs.
    NSString *name = exception.name ?: @"NSException";
    NSString *reason = exception.reason ?: @"";
    // Newlines would break the one-header-per-line format the parser expects.
    reason = [[reason componentsSeparatedByCharactersInSet:
                          [NSCharacterSet newlineCharacterSet]]
        componentsJoinedByString:@" "];

    // `callStackReturnAddresses` is the exception's own stack — where it was
    // raised — which is more useful than where it went unhandled.
    NSArray<NSNumber *> *addresses = exception.callStackReturnAddresses;
    NSUInteger count = MIN(addresses.count, (NSUInteger)kMaxFrames);
    void *frames[kMaxFrames];
    for (NSUInteger i = 0; i < count; i++) {
      frames[i] = (void *)(uintptr_t)addresses[i].unsignedLongLongValue;
    }

    WriteCrashRecord([name UTF8String], [reason UTF8String],
                     count > 0 ? frames : NULL, (int)count);
  }

  // Chain, so a crash reporter installed before us still sees the exception.
  if (sPreviousExceptionHandler) sPreviousExceptionHandler(exception);
}

// ── Install ─────────────────────────────────────────────────────────────────

@implementation BesouroCrashCapture

+ (void)installWithSessionId:(NSString *)sessionId {
  if (sessionId.length == 0) return;

  // Render the two buffers the handlers depend on *before* arming anything, so a
  // crash can never find them half-written.
  NSString *path = [BesouroFileStore pathForFilename:kCrashFile];
  strlcpy(sCrashPath, [path fileSystemRepresentation], sizeof(sCrashPath));

  NSString *line = [NSString stringWithFormat:@"session=%@\n", sessionId];
  strlcpy(sSessionLine, [line UTF8String], sizeof(sSessionLine));
  sSessionLineLength = strlen(sSessionLine);

  if (sInstalled) return;  // Later calls only refresh the session id.
  sInstalled = 1;

  sPreviousExceptionHandler = NSGetUncaughtExceptionHandler();
  NSSetUncaughtExceptionHandler(&HandleUncaughtException);

  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_sigaction = &HandleFatalSignal;
  action.sa_flags = SA_SIGINFO | SA_ONSTACK;  // ONSTACK: a stack overflow SIGSEGV
                                              // has no usable stack left
  sigemptyset(&action.sa_mask);

  for (size_t i = 0; i < kFatalSignalCount; i++) {
    sigaction(kFatalSignals[i], &action, &sPreviousActions[i]);
  }
}

@end
