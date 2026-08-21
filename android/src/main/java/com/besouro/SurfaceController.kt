package com.besouro

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import com.facebook.react.ReactApplication
import com.facebook.react.interfaces.fabric.ReactSurface

/**
 * Owns the ReactSurface — the `RNBesouro` root the JS drawer
 * registers under — and the DecorView child it renders into.
 *
 * It knows nothing about the bubble: sliding it out of the way and springing it
 * back is driven through [onOpened] / [onDismissed].
 *
 * Every method is UI thread only; the module does the hopping.
 */
internal class SurfaceController {

    /** Invoked after the surface has started and been attached. */
    var onOpened: (() -> Unit)? = null

    /** Invoked after the surface view has been removed. */
    var onDismissed: (() -> Unit)? = null

    private var liveSurfaceView: View? = null

    /**
     * Re-adopt the surface view after a Fast Refresh, which recreates the module
     * instance while native views persist. A surface still on record with no view
     * means its host view went away with an activity recreation — detach it, or
     * the ReactHost restarts it on every reload alongside the real one.
     */
    fun reattachOrStopSurface(decorView: FrameLayout) {
        liveSurfaceView = decorView.findViewWithTag<View>(SURFACE_TAG)
        if (liveSurfaceView == null) {
            stopSurface()
        }
    }

    fun open(activity: Activity) {
        val reactHost = (activity.application as? ReactApplication)?.reactHost ?: return
        val decorView = activity.window.decorView as? FrameLayout ?: return

        // Idempotent — drawer already open.
        if (decorView.findViewWithTag<View>(SURFACE_TAG) != null) return

        // Drop any surface left over from a previous open (e.g. one whose view
        // was torn down without going through close) before making a new one.
        stopSurface()

        val surface = reactHost.createSurface(activity, BESOURO_REGISTRY_KEY, null as Bundle?)
        val surfaceView = surface.view ?: return
        surfaceView.tag = SURFACE_TAG
        liveSurface = surface

        decorView.addView(
            surfaceView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
        surface.start()
        liveSurfaceView = surfaceView
        onOpened?.invoke()
    }

    /**
     * Size and position the surface view as a floating rect, in dp, measured from
     * the top-left of the DecorView.
     *
     * Sizing the *host* is what lets the app underneath keep its touches: the
     * surface view stops covering those pixels, so nothing of ours is in the way
     * and no hit-test override is needed. React follows the new bounds on its
     * own — the surface view reports its measure specs back to the ReactSurface.
     *
     * The move is a translation (no relayout); only a size change costs a layout
     * pass — see the guard below.
     */
    fun setFrame(x: Float, y: Float, width: Float, height: Float) {
        val view = liveSurfaceView ?: return
        val density = view.resources.displayMetrics.density
        val widthPx = (width * density + 0.5f).toInt()
        val heightPx = (height * density + 0.5f).toInt()
        val params = view.layoutParams as? FrameLayout.LayoutParams ?: return

        // Only a *size* change may touch the layout params. Assigning them calls
        // requestLayout(), which walks up to the DecorView and — through the
        // surface view's onMeasure — relayouts the whole React tree behind it:
        // tab strip, list, every row. That is the right price for a resize and
        // an absurd one for a drag, which moves the window and changes nothing
        // inside it. Dragging used to pay it on every touch move (100% janky
        // frames, ~121ms each); a translation is applied at draw time and costs
        // nothing, which is why the iOS side never had the problem — moving a
        // UIWindow lays nothing out.
        if (params.width != widthPx ||
            params.height != heightPx ||
            params.gravity != FRAME_GRAVITY
        ) {
            params.width = widthPx
            params.height = heightPx
            params.gravity = FRAME_GRAVITY
            view.layoutParams = params
        }

        view.translationX = x * density
        view.translationY = y * density
    }

    /** Put the surface view back to filling its host. */
    fun resetFrame() {
        val view = liveSurfaceView ?: return
        val params = view.layoutParams as? FrameLayout.LayoutParams ?: return
        if (params.width != FrameLayout.LayoutParams.MATCH_PARENT ||
            params.height != FrameLayout.LayoutParams.MATCH_PARENT
        ) {
            params.width = FrameLayout.LayoutParams.MATCH_PARENT
            params.height = FrameLayout.LayoutParams.MATCH_PARENT
            view.layoutParams = params
        }
        view.translationX = 0f
        view.translationY = 0f
    }

    fun close(activity: Activity) {
        val decorView = activity.window.decorView as? FrameLayout ?: return
        dismiss(decorView)
    }

    /**
     * Remove the surface view *and* stop its ReactSurface, then report it. Stopping
     * is what detaches the surface from the ReactHost: a surface that is only
     * removed from the view hierarchy stays attached, so every JS reload restarts
     * it (one stray `Running "RNBesouro"` per drawer ever opened) and it
     * keeps rendering into a detached view.
     */
    fun dismiss(decorView: FrameLayout) {
        val view = liveSurfaceView ?: decorView.findViewWithTag<View>(SURFACE_TAG)
        view?.let { decorView.removeView(it) }
        liveSurfaceView = null
        stopSurface()
        onDismissed?.invoke()
    }

    /** Stop and forget the current surface, if any. */
    private fun stopSurface() {
        val surface = liveSurface ?: return
        liveSurface = null
        try {
            surface.stop()
        } catch (_: Exception) {
            // Best-effort teardown — never let a dying surface break close/open.
        }
    }

    companion object {
        /** The AppRegistry key the JS drawer registers under (src/core/besouro-registry-key.ts). */
        private const val BESOURO_REGISTRY_KEY = "RNBesouro"

        /**
         * Tags our DecorView child so it can be found again — after a Fast
         * Refresh, or to make [open] idempotent. Process-local and unrelated to
         * the AppRegistry key above; it only has to be unique among the host
         * app's views, like [DraggableBubbleView.VIEW_TAG] and `PICK_TAG`.
         */
        private const val SURFACE_TAG = "RNBesouroSurface"

        /**
         * The floating panel is positioned by translation from the DecorView's
         * top-left, so its params must anchor there rather than inherit the
         * default. Held as a constant because [setFrame] compares against it to
         * decide whether a layout pass is needed at all.
         */
        private const val FRAME_GRAVITY = Gravity.TOP or Gravity.START

        /**
         * The live ReactSurface, if the drawer is open. Process-wide rather
         * than per-instance because a JS reload recreates the module while the
         * native views (and the surface behind them) survive — an instance field
         * would lose the handle and leak the surface on the next close.
         * Only touched on the UI thread.
         */
        @Volatile
        private var liveSurface: ReactSurface? = null
    }
}
