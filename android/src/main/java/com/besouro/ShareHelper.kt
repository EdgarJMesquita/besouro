package com.besouro

import android.app.Activity
import android.content.ClipData
import android.content.ClipDescription
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Base64
import android.util.Log
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File

/**
 * The system share sheet, for a sandbox file the File System inspector is
 * browsing or for bytes the Network inspector captured. Files are shared in
 * place via a private FileProvider (see AndroidManifest.xml).
 *
 * Read access is granted three ways, and all three are load-bearing:
 *  1. ClipData carrying the file's real MIME type. Leaving this to the
 *     platform's EXTRA_STREAM auto-migration produces a `text/uri-list` raw
 *     clip, which receivers that read `intent.clipData` reject for an image.
 *  2. FLAG_GRANT_READ_URI_PERMISSION on the send intent *and* the chooser —
 *     the latter is what lets the Android 13+ sheet render a preview.
 *  3. An explicit, package-scoped grant to every app that can handle the
 *     intent. The intent grant dies with the receiving activity; WhatsApp
 *     and Slack hand the URI to another component (contact/channel picker →
 *     send or upload worker) that reads it after that activity is gone.
 *     Telegram reads the stream in the receiving activity, which is why it
 *     worked while the others failed.
 *
 * Fire-and-forget: a missing file, an unshareable path, or the absence of an
 * Activity is a no-op (this is a debug affordance, not a core flow).
 *
 * UI thread only; the module does the hopping.
 */
internal class ShareHelper(private val reactContext: ReactApplicationContext) {

    /**
     * Throwaway copies of in-memory payloads handed to the share sheet. Lives in
     * cacheDir — already a FileProvider root (see xml/besouro_file_paths.xml)
     * and reclaimable by the OS — rather than in the file store, so a share never
     * leaves anything in the persistence store the File System inspector browses.
     */
    private val shareDir: File by lazy {
        File(reactContext.cacheDir, SHARE_DIR)
    }

    fun shareFile(activity: Activity, path: String, mimeType: String) {
        try {
            val file = File(path)
            if (!file.isFile) return
            presentShare(activity, file, mimeType)
        } catch (e: Exception) {
            // getUriForFile throws for paths outside the configured roots, and
            // startActivity can throw ActivityNotFoundException — both no-op,
            // but log so a failed share isn't invisible in a debug tool.
            Log.w(LOG_TAG, "shareFile failed for $path", e)
        }
    }

    /**
     * Share bytes that only exist in JS (a captured network image) by decoding
     * them into a throwaway file under [shareDir], then sharing that file.
     *
     * The file outlives the call by design: the receiving app opens the
     * `content://` URI after the chooser returns — often after this process is
     * backgrounded — so deleting it here would share an empty file, and Android
     * offers no "the receiver is finished" callback to delete it later. Instead
     * the directory is swept on entry, and callers pass a stable [filename] so a
     * repeat share overwrites rather than accumulates — between the two, at most
     * one stale file survives, in cache storage the OS can reclaim on its own.
     */
    fun shareBase64File(activity: Activity, base64: String, filename: String, mimeType: String) {
        try {
            val bytes = Base64.decode(base64, Base64.DEFAULT)
            if (bytes.isEmpty()) return
            val dir = shareDir
            dir.deleteRecursively()
            dir.mkdirs()
            // Strip any directory part: the name comes from JS and only ever
            // labels the payload — it must not steer the write out of [dir].
            val name = filename.substringAfterLast('/').ifEmpty { "image" }
            val file = File(dir, name)
            file.writeBytes(bytes)
            presentShare(activity, file, mimeType)
        } catch (e: Exception) {
            Log.w(LOG_TAG, "shareBase64File failed for $filename", e)
        }
    }

    /** Build and launch the chooser for [file]. Callers hold the UI thread. */
    private fun presentShare(activity: Activity, file: File, mimeType: String) {
        val authority = "${reactContext.packageName}.besouro.fileprovider"
        val uri = FileProvider.getUriForFile(reactContext, authority, file)
        val type = mimeType.ifEmpty { "application/octet-stream" }

        val send = Intent(Intent.ACTION_SEND).apply {
            setTypeAndNormalize(type)
            putExtra(Intent.EXTRA_STREAM, uri)
            // Names the Android 13+ share-sheet preview.
            putExtra(Intent.EXTRA_TITLE, file.name)
            clipData = ClipData(
                ClipDescription(file.name, arrayOf(type)),
                ClipData.Item(uri)
            )
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

        grantReadToShareTargets(send, uri)

        val chooser = Intent.createChooser(send, null).apply {
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        // Deliberately no FLAG_ACTIVITY_NEW_TASK: `activity` is non-null right
        // here (checked by the caller, same UI-thread block), and giving the
        // chooser its own task weakens the caller identity the sharesheet uses to
        // re-grant the URI to whichever target is picked.
        activity.startActivity(chooser)
    }

    /**
     * Grant read access on [uri] to every app that can handle [send], outliving
     * the receiving activity. Needs the `<queries>` element in AndroidManifest.xml
     * on targetSdk >= 30, or package-visibility filtering returns an empty list
     * and this silently does nothing.
     */
    private fun grantReadToShareTargets(send: Intent, uri: Uri) {
        val packageManager = reactContext.packageManager
        val targets = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.queryIntentActivities(
                send,
                PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong())
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.queryIntentActivities(send, PackageManager.MATCH_DEFAULT_ONLY)
        }
        for (target in targets) {
            reactContext.grantUriPermission(
                target.activityInfo.packageName,
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        }
    }

    companion object {
        /** Cache subdirectory holding the temporary copy behind [shareBase64File]. */
        private const val SHARE_DIR = "besouro-share"
        private const val LOG_TAG = "Besouro"
    }
}
