package com.besouro

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * The library's own directory in the app's internal storage
 * (`<filesDir>/besouro/`), holding everything it keeps on disk: the
 * JS-side settings files behind `readFile`/`writeFile`/`deleteFile`, and the
 * persisted bubble position.
 *
 * It is the single definition of that location — anything of ours that touches
 * the directory goes through here rather than rebuilding the path. (The captured
 * event database is not here: it goes through `Context.openOrCreateDatabase`,
 * which owns its own `databases/` directory.)
 *
 * Reads and writes are best-effort: this backs a debug tool, so a failure is
 * reported to JS where a promise is involved and swallowed where one isn't.
 */
internal class FileStore(private val context: Context) : BubbleStore {

    val directory: File by lazy {
        File(context.filesDir, STORAGE_DIR).also { it.mkdirs() }
    }

    fun fileFor(filename: String): File = File(directory, filename)

    /** UTF-8 contents of [filename], or null when it does not exist. Throws on
     *  an unreadable file so the caller can reject its promise. */
    fun read(filename: String): String? {
        val file = fileFor(filename)
        return if (file.exists()) file.readText(Charsets.UTF_8) else null
    }

    fun write(filename: String, content: String) {
        fileFor(filename).writeText(content, Charsets.UTF_8)
    }

    fun delete(filename: String) {
        fileFor(filename).delete()
    }

    // ── Bubble position ─────────────────────────────────────────────────────
    // Kept here rather than in a separate SharedPreferences so all persistence
    // lives in one place (and the saved position is visible in the File System
    // inspector). Stored as 0–1 ratios of the draggable range so it survives
    // restarts and screen-size/rotation changes.

    override fun loadBubblePosition(): Pair<Float, Float>? {
        return try {
            val file = fileFor(BUBBLE_POSITION_FILE)
            if (!file.exists()) return null
            val position = JSONObject(file.readText(Charsets.UTF_8))
            Pair(position.getDouble("x").toFloat(), position.getDouble("y").toFloat())
        } catch (_: Exception) {
            null
        }
    }

    override fun saveBubblePosition(normalizedX: Float, normalizedY: Float) {
        try {
            write(BUBBLE_POSITION_FILE, "{\"x\":$normalizedX,\"y\":$normalizedY}")
        } catch (_: Exception) {
        }
    }

    // ── Bubble appearance ───────────────────────────────────────────────────
    // Read out of the JS settings file, which JS owns and writes — the only file
    // here read from both sides. The bubble needs its colors before its entrance
    // animation, and JS reads this file asynchronously, so it cannot supply them
    // in time. Only the two keys below are read; the rest of the file is the
    // drawer's business. See `settings-store.ts`, where they are defined.

    override fun loadBubbleAppearance(): StoredBubbleAppearance {
        return try {
            val file = fileFor(SETTINGS_FILE)
            if (!file.exists()) return StoredBubbleAppearance(null, null)
            val settings = JSONObject(file.readText(Charsets.UTF_8))
            StoredBubbleAppearance(
                theme = settings.optStringOrNull("theme"),
                accent = settings.optStringOrNull("accent"),
            )
        } catch (_: Exception) {
            StoredBubbleAppearance(null, null)
        }
    }

    /**
     * The string at [key], or null when it is absent, JSON `null`, or empty. Both
     * settings default to a written `null` rather than a missing key, and
     * `optString` renders that as the literal `"null"` — hence the explicit
     * [JSONObject.isNull] check.
     */
    private fun JSONObject.optStringOrNull(key: String): String? {
        if (isNull(key)) return null
        return optString(key).takeIf { it.isNotEmpty() }
    }

    companion object {
        private const val STORAGE_DIR = "besouro"
        private const val BUBBLE_POSITION_FILE = "bubble-position.json"
        private const val SETTINGS_FILE = "besouro_settings.json"
    }
}
