/**
 * Metro provides a CommonJS `require` at runtime. We use it to defensively load
 * private React Native interceptor modules (e.g. XHRInterceptor) with a
 * feature-detect fallback, since those have no public type declarations.
 */
declare function require(moduleName: string): unknown;

/**
 * Set by the Fabric renderer when it installs its UIManager binding. Absent on
 * the legacy renderer, which is how the drawer detects that a Fabric-only native
 * component (the HTML preview web view) can't be rendered.
 */
declare const nativeFabricUIManager: object | undefined;
