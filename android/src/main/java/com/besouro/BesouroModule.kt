package com.besouro

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.view.HapticFeedbackConstants
import android.widget.FrameLayout
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference

/**
 * The overlay TurboModule for besouro (SPEC §7): the native floating
 * bubble, the drawer's ReactSurface, the element-pick overlay, and the small
 * platform bridges the drawer needs from outside the app's React tree.
 *
 * Every method here is an entry point and nothing more. The work lives in
 * dedicated collaborators — [BubbleController], [SurfaceController],
 * [ElementPicker], [FileStore], [ShareHelper], [SafeAreaInsets] — and this class
 * owns three responsibilities they cannot: the warm/cold reload flag, the UI
 * thread hop each spec call needs, and the wiring between the bubble and the
 * drawer (which deliberately know nothing about each other).
 *
 * NOTE: [mountBubble] must not be named `initialize`/`invalidate` — those are
 * reserved TurboModule lifecycle hooks the infrastructure auto-invokes at module
 * create/destroy.
 */
class BesouroModule(reactContext: ReactApplicationContext) :
    NativeBesouroSpec(reactContext) {

    override fun getName(): String = NAME

    // Whether this module instance was created in a process that had already
    // hosted an earlier one — i.e. a JS reload (warm), not a cold process start.
    // A native crash kills the process, so its relaunch reads as cold. Captured
    // once at construction; see [isWarmReload].
    private val warmReload: Boolean =
        synchronized(BesouroModule::class.java) {
            val warm = processInitialized
            processInitialized = true
            warm
        }

    override fun isWarmReload(): Boolean = warmReload

    /** The newest frame a drag has reported, waiting for the UI thread. */
    private val pendingFrame = AtomicReference<FloatArray?>(null)

    private val fileStore = FileStore(reactContext)
    private val bubbleController = BubbleController(reactContext, fileStore)
    private val surfaceController = SurfaceController()
    private val elementPicker = ElementPicker(reactContext)
    private val shareHelper = ShareHelper(reactContext)
    private val safeAreaInsets = SafeAreaInsets(reactContext)

    init {
        // The bubble reports a tap; the drawer reports open/dismiss. Neither
        // references the other — this is the only place the two are joined.
        bubbleController.onTap = { openDrawer() }
        surfaceController.onOpened = { bubbleController.slideAway() }
        surfaceController.onDismissed = { bubbleController.returnToRest() }
    }

    // ── Native overlay ────────────────────────────────────────────────────────

    override fun mountBubble(
        configuredTheme: String,
        lightBackground: String,
        lightIcon: String,
        darkBackground: String,
        darkIcon: String,
    ) {
        val activity = reactApplicationContext.currentActivity ?: return
        // Guard only: without a ReactHost the drawer could never be created, so
        // there is no point mounting a bubble that opens nothing.
        (activity.application as? ReactApplication)?.reactHost ?: return

        val themes = BubbleThemeColors(
            configuredTheme, lightBackground, lightIcon, darkBackground, darkIcon,
        )
        UiThreadUtil.runOnUiThread {
            val decorView = activity.window.decorView as? FrameLayout ?: return@runOnUiThread
            // Fast Refresh recreates this module while the native views persist,
            // so both collaborators re-adopt what is already on the DecorView.
            surfaceController.reattachOrStopSurface(decorView)
            bubbleController.mount(activity, decorView, themes)
        }
    }

    override fun openDrawer() {
        val activity = reactApplicationContext.currentActivity ?: return
        UiThreadUtil.runOnUiThread {
            surfaceController.open(activity)
        }
    }

    override fun closeDrawer() {
        UiThreadUtil.runOnUiThread {
            val activity = reactApplicationContext.currentActivity ?: return@runOnUiThread
            surfaceController.close(activity)
        }
    }

    /**
     * A drag reports a new frame per touch move — faster than the UI thread can
     * always drain. Posting a runnable each time queues them up, and the panel
     * then lurches through a backlog of positions the finger has already left.
     *
     * So only one is ever in flight: a later frame overwrites the pending one,
     * and the runnable applies whatever is newest when it runs. Nothing stale is
     * drawn, and the panel lands where the finger is rather than where it was.
     */
    override fun setSurfaceFrame(x: Double, y: Double, width: Double, height: Double) {
        val frame = floatArrayOf(x.toFloat(), y.toFloat(), width.toFloat(), height.toFloat())
        if (pendingFrame.getAndSet(frame) != null) {
            // A runnable is already queued; it will pick this frame up instead.
            return
        }
        UiThreadUtil.runOnUiThread {
            val next = pendingFrame.getAndSet(null) ?: return@runOnUiThread
            surfaceController.setFrame(next[0], next[1], next[2], next[3])
        }
    }

    override fun resetSurfaceFrame() {
        // Drop any frame still waiting: it describes a panel that is going away.
        pendingFrame.set(null)
        UiThreadUtil.runOnUiThread {
            surfaceController.resetFrame()
        }
    }

    override fun setBubbleAppearance(background: String, iconColor: String) {
        UiThreadUtil.runOnUiThread {
            bubbleController.applyAppearance(background, iconColor)
        }
    }

    /**
     * Enter element-pick mode. Dismiss the drawer (so taps reach the app) and hand
     * off to [ElementPicker], which reports the tapped point and the native view
     * chain under it. JS resolves the element and calls [openDrawer] to come back.
     */
    override fun startElementInspection(onResult: Callback) {
        val activity = reactApplicationContext.currentActivity ?: return
        UiThreadUtil.runOnUiThread {
            val decorView = activity.window.decorView as? FrameLayout ?: return@runOnUiThread
            surfaceController.dismiss(decorView)
            elementPicker.start(activity, onResult)
        }
    }

    // ── Filesystem persistence ────────────────────────────────────────────────

    override fun readFile(filename: String, promise: Promise) {
        try {
            promise.resolve(fileStore.read(filename))
        } catch (e: Exception) {
            promise.reject("Besouro", e)
        }
    }

    override fun writeFile(filename: String, content: String, promise: Promise) {
        try {
            fileStore.write(filename, content)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("Besouro", e)
        }
    }

    override fun deleteFile(filename: String, promise: Promise) {
        try {
            fileStore.delete(filename)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("Besouro", e)
        }
    }

    // ── Native crash capture ──────────────────────────────────────────────────

    override fun setCrashContext(sessionId: String) {
        CrashCapture.install(fileStore, sessionId)
    }

    // ── Safe-area insets ──────────────────────────────────────────────────────

    override fun getSafeAreaInsets(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.resolve(safeAreaInsets.zero())
            return
        }
        UiThreadUtil.runOnUiThread {
            try {
                promise.resolve(safeAreaInsets.read(activity))
            } catch (e: Exception) {
                promise.reject("Besouro", e)
            }
        }
    }

    // ── Device locale ─────────────────────────────────────────────────────────
    // The drawer's i18n resolves its language from this. Read from the *app's*
    // configuration rather than Locale.getDefault(), so a per-app language
    // override is honoured and a system locale change is picked up without a
    // process restart. Reading config is thread-safe, so no UI thread hop — which
    // keeps the call synchronous for JS.

    override fun getDeviceLocale(): String {
        val locales = reactApplicationContext.resources.configuration.locales
        val locale = if (locales.isEmpty) Locale.getDefault() else locales[0]
        return locale.toLanguageTag()
    }

    // ── Clipboard ─────────────────────────────────────────────────────────────
    // Write-only. Runs on the UI thread — some OEM clipboard services crash when
    // setPrimaryClip is called off the main thread.

    override fun setClipboardString(text: String) {
        UiThreadUtil.runOnUiThread {
            val clipboard = reactApplicationContext
                .getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                ?: return@runOnUiThread
            clipboard.setPrimaryClip(ClipData.newPlainText(CLIPBOARD_LABEL, text))
        }
    }

    // ── Haptics ───────────────────────────────────────────────────────────────

    // Routed through the view rather than the Vibrator service: performHapticFeedback
    // asks the window session, so it needs no VIBRATE permission in the host app's
    // manifest, and it honours the user's system haptics setting (no
    // FLAG_IGNORE_GLOBAL_SETTING — a devtool has no business overriding that).
    // LONG_PRESS is the constant for exactly this event: something lifted under a
    // finger that is still down.
    override fun haptic() {
        UiThreadUtil.runOnUiThread {
            val view = reactApplicationContext.currentActivity?.window?.decorView
                ?: return@runOnUiThread
            view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        }
    }

    // ── Share ─────────────────────────────────────────────────────────────────

    override fun shareFile(path: String, mimeType: String) {
        UiThreadUtil.runOnUiThread {
            val activity = reactApplicationContext.currentActivity ?: return@runOnUiThread
            shareHelper.shareFile(activity, path, mimeType)
        }
    }

    override fun shareBase64File(base64: String, filename: String, mimeType: String) {
        UiThreadUtil.runOnUiThread {
            val activity = reactApplicationContext.currentActivity ?: return@runOnUiThread
            shareHelper.shareBase64File(activity, base64, filename, mimeType)
        }
    }

    companion object {
        const val NAME = NativeBesouroSpec.NAME

        /** Process-lifetime flag: set the first time the module is created in a
         *  process, so later instances (after a JS reload) can tell warm from cold. */
        @Volatile
        private var processInitialized = false

        /** ClipData label for clipboard writes — shown to clipboard managers /
         *  accessibility services, not the copied content itself. */
        private const val CLIPBOARD_LABEL = "Besouro"
    }
}
