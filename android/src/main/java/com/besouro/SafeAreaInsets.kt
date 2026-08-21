package com.besouro

import android.app.Activity
import android.os.Build
import android.view.WindowInsets
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap

/**
 * The surface fills the DecorView (behind the status/nav bars), so JS has
 * no SafeAreaProvider to read from. Report the system-bar + display-cutout
 * insets, converted from px to dp so they drop straight into React layout.
 *
 * [read] touches window insets and so is UI thread only; the module does the
 * hopping. [zero] is safe anywhere.
 */
internal class SafeAreaInsets(private val reactContext: ReactApplicationContext) {

    @Suppress("DEPRECATION")
    fun read(activity: Activity): WritableMap {
        val density = reactContext.resources.displayMetrics.density
        val windowInsets = activity.window.decorView.rootWindowInsets
        var top = 0
        var bottom = 0
        var left = 0
        var right = 0
        if (windowInsets != null) {
            if (Build.VERSION.SDK_INT >= 30) {
                val systemInsets = windowInsets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()
                )
                top = systemInsets.top
                bottom = systemInsets.bottom
                left = systemInsets.left
                right = systemInsets.right
            } else {
                top = windowInsets.systemWindowInsetTop
                bottom = windowInsets.systemWindowInsetBottom
                left = windowInsets.systemWindowInsetLeft
                right = windowInsets.systemWindowInsetRight
            }
        }
        // The surface is attached to the DecorView, which spans behind
        // the status bar. Non-edge-to-edge apps report a 0 top inset there,
        // which would leave the header tucked under the status bar — fall back
        // to the status-bar height from resources so the top is always cleared.
        if (top == 0) top = statusBarHeightPx()

        return Arguments.createMap().apply {
            putDouble("top", (top / density).toDouble())
            putDouble("bottom", (bottom / density).toDouble())
            putDouble("left", (left / density).toDouble())
            putDouble("right", (right / density).toDouble())
        }
    }

    fun zero(): WritableMap = Arguments.createMap().apply {
        putDouble("top", 0.0)
        putDouble("bottom", 0.0)
        putDouble("left", 0.0)
        putDouble("right", 0.0)
    }

    /** Status-bar height (px) from the platform resource, or 0 if unavailable.
     *  Reliable regardless of edge-to-edge / window-inset reporting. */
    private fun statusBarHeightPx(): Int {
        val resources = reactContext.resources
        val id = resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) resources.getDimensionPixelSize(id) else 0
    }
}
