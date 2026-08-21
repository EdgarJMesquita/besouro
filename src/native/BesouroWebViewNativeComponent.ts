// Imported from the package root rather than the usual deep
// `Libraries/Utilities/…` path: this project type-checks under React Native's
// strict API (see `customConditions` in tsconfig.json), which blocks deep
// imports and re-exports both of these from the root. Codegen keys on the
// `codegenNativeComponent(...)` call, not on where it came from.
import { codegenNativeComponent } from 'react-native';
import type { CodegenTypes, ViewProps } from 'react-native';

/**
 * Minimal native web view — a `WKWebView` (iOS) / `android.webkit.WebView`
 * (Android) the drawer can render inline. It exists so the Network inspector can
 * show an HTML response as a page instead of as markup, without pulling
 * `react-native-webview` into a library that otherwise has no runtime deps.
 *
 * Deliberately not a general-purpose browser: no navigation, no JS injection, no
 * message bridge. Two props is the whole surface. What it renders is an
 * untrusted response body, so the native side loads it with JavaScript disabled,
 * no file/content access, and an ephemeral data store (no shared cookie jar).
 *
 * **New architecture only.** There is no `RCTViewManager` fallback, so on a
 * pre-0.82 app running the legacy renderer the component isn't registered —
 * callers must gate on `isFabricRenderer()` (../shared/fabric.ts) and fall back.
 * This file holds nothing but the spec: codegen parses it.
 */
interface NativeProps extends ViewProps {
  /**
   * What to load. `html` is loaded as a document with a nil/absent base url, so
   * relative subresources don't resolve and a preview can't fire network
   * requests of its own; `uri` is fetched normally. `html` wins when both are
   * set, and an empty source leaves the view blank.
   */
  source?: Readonly<{ html?: string; uri?: string }>;

  /**
   * Main-frame load failure — a bad uri, an unreachable host, or (iOS) the web
   * content process terminating. Subresource failures are not reported.
   */
  onError?: CodegenTypes.DirectEventHandler<Readonly<{ message: string }>>;
}

export default codegenNativeComponent<NativeProps>('BesouroWebView');
