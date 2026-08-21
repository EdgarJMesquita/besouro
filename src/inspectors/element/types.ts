/**
 * Element inspector types shared across its modules — internal.
 *
 * None of this is part of the public surface: the drawer
 * is the only consumer of an inspected element, so these are shared between the
 * picker, the live-element store, and the tab, and go no further.
 *
 * Only types crossing a file boundary belong here. The picker's own vocabulary
 * (the renderer hit-test payload, the React DevTools hook and fiber shapes) stays
 * file-local in `picker.ts` — hoisting single-file types here would just recreate
 * the leak one level down.
 */

/** Box model of the inspected element, in device-independent pixels. */
export interface ElementFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where an inspected element's data came from, which decides how much of it there
 * is. Ordered by richness — the picker tries them in this order.
 *
 * - `renderer` — the full picture: React component names, props, and live editing
 *   through `overrideProps`. Needs the renderer's own hit-test, so debug only.
 * - `fiber` — React component names and props read straight off the fiber the
 *   native pick pointed us at. Works in release (see `./devtools-hook`), but the
 *   prod renderer bundle ships no `overrideProps`, so everything is **read-only**
 *   — style included, since style is a prop like any other and takes the same
 *   write path.
 * - `native` — the platform's view tree alone: native class names, on-screen
 *   bounds, `testID`. No props. The floor, when no fiber matches.
 */
export type ElementOrigin = 'renderer' | 'fiber' | 'native';

/** Serializable view of the inspected element rendered by the Element tab. */
export interface InspectedElement {
  origin: ElementOrigin;
  componentName: string;
  hierarchy: string[];
  /**
   * Live props object (kept raw so values stay editable); never persisted.
   * Always empty when `origin` is `native` — the platform view tree has no notion
   * of React props, so the tab hides the props and style sections entirely rather
   * than showing an empty one that reads like a bug.
   */
  props: Record<string, unknown>;
  frame?: ElementFrame;
  /** Source `file:line`, when available (empty on React 19 — see picker.ts). */
  source?: string;
  /** The touched view's `testID`, when it has one. Native picks only — it's the
   *  one human-readable identity available without the React tree. */
  testID?: string;
}

/** The renderer-internals subset we drive for live prop editing. */
export interface ElementRenderer {
  overrideProps?: (
    fiber: unknown,
    path: Array<string | number>,
    value: unknown
  ) => void;
}
