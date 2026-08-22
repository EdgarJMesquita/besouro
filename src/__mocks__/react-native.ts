/**
 * `react-native` stub for the unit tests. The suite runs in a plain node
 * environment (see jest.config.js) with no React Native preset, so RN's own
 * entry point — Flow-typed ESM — can't be parsed. Any module that reaches a
 * TurboModule spec, even transitively (i18n → NativeBesouro), would fail
 * at import time without this.
 *
 * `TurboModuleRegistry.get` returns null, which is exactly what it does in a
 * host where the module isn't linked. That makes "native absent" the default in
 * tests, so the fallback paths are what gets exercised unless a test opts into a
 * fake — as core/__tests__/share.test.ts does, by mocking the native wrapper
 * module itself rather than this file.
 */

export const TurboModuleRegistry = {
  get: () => null,
  getEnforcing: (name: string) => {
    throw new Error(`TurboModuleRegistry.getEnforcing('${name}') in tests`);
  },
};

/**
 * The screen the drawer's geometry reasons about, and the rounding it does on the
 * way to native. Fixed values rather than a device's, so a test that pushes a
 * frame knows exactly what should come out the other side: a 390×844 screen at
 * the 2x density where whole-dp frames survive the round untouched.
 */
export const Dimensions = {
  get: () => ({ width: 390, height: 844 }),
};

export const PixelRatio = {
  roundToNearestPixel: (value: number) => Math.round(value * 2) / 2,
};

/**
 * Enough of the registry for the controller's mount path, which registers the
 * drawer's root component before asking native for a bubble. Registration is a
 * no-op here — nothing in a node environment ever runs the surface — but it has
 * to exist, or the mount throws before reaching the part under test.
 */
export const AppRegistry = {
  registerComponent: (_key: string, _getComponent: () => unknown) => {},
};
