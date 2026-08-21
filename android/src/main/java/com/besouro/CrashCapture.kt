package com.besouro

/**
 * Records a native crash into a spool file the next launch reads back into the
 * Console tab.
 *
 * A crash that reaches [Thread.setDefaultUncaughtExceptionHandler] takes the
 * process with it, so nothing can be handed to JS: by the time this runs there is
 * no flush left to await, not even the blocking one the JS crash path uses
 * (`core/capture.ts`). What is still possible is a plain file write — the JVM is
 * alive here, unlike its iOS counterpart, which has to survive a signal handler —
 * so the record goes to disk and `core/crash-ingest.ts` turns it into a `crash`
 * console row under the session that died, on the next launch.
 *
 * Covers Kotlin/Java exceptions on any thread. NDK/C++ signal crashes are not
 * covered: they never reach this handler.
 */
internal object CrashCapture {

    /** Set once by [install]; read by the handler on whatever thread crashed. */
    @Volatile
    private var sessionId: String = ""

    private var previous: Thread.UncaughtExceptionHandler? = null
    private var installed = false

    /**
     * Install the handler (once per process) and record which session is live.
     *
     * Called on every session start rather than at module construction, so an app
     * that never initializes the library keeps its handler chain untouched, and a
     * crash before the library is up can't produce a record with no session to
     * attach it to. Later calls only update [sessionId].
     */
    @Synchronized
    fun install(fileStore: FileStore, session: String) {
        sessionId = session
        if (installed) return
        installed = true

        previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                record(fileStore, thread, throwable)
            } catch (_: Throwable) {
                // Never let the recording mask the crash being recorded.
            }
            // Chain last, and always: the previous handler is what shows the dev
            // redbox and what ends the process, so skipping it would change how
            // the app behaves on a crash. Whatever a crash reporter installed
            // before us stays in the chain too.
            previous?.uncaughtException(thread, throwable)
        }
    }

    private fun record(fileStore: FileStore, thread: Thread, throwable: Throwable) {
        val session = sessionId
        if (session.isEmpty()) return

        val file = fileStore.fileFor(CRASH_FILE)
        // A crash loop relaunching into a broken database would otherwise append
        // forever. Nothing here is worth keeping over the newest record.
        if (file.length() > MAX_FILE_BYTES) file.delete()

        file.appendText(
            buildString {
                append(BLOCK_START).append('\n')
                append("session=").append(session).append('\n')
                append("platform=android\n")
                append("time=").append(System.currentTimeMillis()).append('\n')
                // The thread logcat names in its `FATAL EXCEPTION: <thread>`
                // header — `main` for most, and the interesting cases are the
                // ones where it isn't.
                append("thread=").append(oneLine(thread.name)).append('\n')
                append("name=").append(oneLine(throwable.javaClass.name)).append('\n')
                append("message=").append(oneLine(throwable.message ?: "")).append('\n')
                append("stack\n")
                append(throwable.stackTraceToString().take(MAX_STACK_CHARS)).append('\n')
                append(BLOCK_END).append('\n')
            },
            Charsets.UTF_8
        )
    }

    /** Keep a header value on its own line — the parser reads one per line. */
    private fun oneLine(value: String): String =
        value.replace(Regex("\\s+"), " ").trim()

    private const val CRASH_FILE = "pending-crash.log"
    private const val BLOCK_START = "--- crash"
    private const val BLOCK_END = "--- end"

    /** Spool cap; see the reset in [record]. */
    private const val MAX_FILE_BYTES = 256L * 1024

    /** Stack cap, matching the message cap the JS side applies on ingest. */
    private const val MAX_STACK_CHARS = 8_000
}
