package com.besouro

import android.util.Base64
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.viewmanagers.BesouroWebViewManagerDelegate
import com.facebook.react.viewmanagers.BesouroWebViewManagerInterface
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap

/**
 * View manager for the `BesouroWebView` component (spec in
 * src/native/BesouroWebViewNativeComponent.ts) — a plain [WebView] with a
 * `source` prop and an `onError` event, used by the Network inspector to render
 * an HTML response body.
 *
 * The content is an untrusted response captured off the wire, so the WebView is
 * stripped down: no JavaScript, no file or content:// access, no DOM storage.
 */
class BesouroWebViewManager :
    SimpleViewManager<WebView>(), BesouroWebViewManagerInterface<WebView> {

    private val delegate = BesouroWebViewManagerDelegate(this)

    override fun getDelegate(): ViewManagerDelegate<WebView> = delegate

    override fun getName(): String = NAME

    override fun createViewInstance(context: ThemedReactContext): WebView =
        WebView(context).apply {
            layoutParams =
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            settings.javaScriptEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.domStorageEnabled = false
            webViewClient =
                object : WebViewClient() {
                    override fun onReceivedError(
                        view: WebView,
                        request: WebResourceRequest,
                        error: WebResourceError
                    ) {
                        // Subresource failures are noise for a preview — only a
                        // main-frame failure means the page isn't there.
                        if (request.isForMainFrame) {
                            emitError(view, error.description?.toString().orEmpty())
                        }
                    }
                }
        }

    @ReactProp(name = "source")
    override fun setSource(view: WebView, value: ReadableMap?) {
        val html = value?.takeIf { it.hasKey(KEY_HTML) }?.getString(KEY_HTML)
        if (!html.isNullOrEmpty()) {
            // Base64 rather than loadDataWithBaseURL(null, …): the latter mangles
            // non-ASCII bytes regardless of the charset it is handed. A null base
            // url also leaves relative subresources unresolvable, so a preview
            // never fires requests of its own that the inspector wouldn't see.
            view.loadData(
                Base64.encodeToString(html.toByteArray(Charsets.UTF_8), Base64.NO_WRAP),
                "text/html; charset=utf-8",
                "base64"
            )
            return
        }

        val uri = value?.takeIf { it.hasKey(KEY_URI) }?.getString(KEY_URI)
        if (!uri.isNullOrEmpty()) {
            view.loadUrl(uri)
            return
        }

        view.loadUrl(BLANK_URL)
    }

    override fun onDropViewInstance(view: WebView) {
        // A WebView left attached keeps its window (and the whole page) alive well
        // past the surface that hosted it.
        view.loadUrl(BLANK_URL)
        view.webViewClient = WebViewClient()
        (view.parent as? ViewGroup)?.removeView(view)
        view.destroy()
        super.onDropViewInstance(view)
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
        mutableMapOf(ERROR_EVENT to mutableMapOf("registrationName" to "onError"))

    private fun emitError(view: WebView, message: String) {
        val context = UIManagerHelper.getReactContext(view)
        UIManagerHelper.getEventDispatcherForReactTag(context, view.id)
            ?.dispatchEvent(ErrorEvent(UIManagerHelper.getSurfaceId(view), view.id, message))
    }

    private class ErrorEvent(surfaceId: Int, viewTag: Int, private val message: String) :
        Event<ErrorEvent>(surfaceId, viewTag) {
        override fun getEventName(): String = ERROR_EVENT

        override fun getEventData(): WritableMap =
            Arguments.createMap().apply { putString("message", message) }
    }

    companion object {
        const val NAME = "BesouroWebView"
        private const val ERROR_EVENT = "topError"
        private const val KEY_HTML = "html"
        private const val KEY_URI = "uri"
        private const val BLANK_URL = "about:blank"
    }
}
