/**
 * Renderer detection. The library's own view component (the web view behind the
 * Network inspector's HTML preview) is registered with Fabric only — there is no
 * legacy `RCTViewManager` counterpart — so any UI that renders it has to ask
 * first and fall back when the answer is no.
 */

/**
 * Whether this runtime renders through Fabric. The renderer installs
 * `global.nativeFabricUIManager` when it starts up, so its presence is the check;
 * a legacy-renderer app (React Native ≤ 0.81 with the New Architecture off)
 * leaves it undefined.
 */
export function isFabricRenderer(): boolean {
  return typeof nativeFabricUIManager !== 'undefined';
}
