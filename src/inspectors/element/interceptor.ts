/**
 * Element inspector — install.
 *
 * Install only enables the tab. Capture is driven later by the tap-to-inspect
 * session in `./picker`, which the Element tab starts; that, the live-element store
 * and the tab's types are all drawer-internal.
 *
 * Named `interceptor` for symmetry with the other inspectors even though it patches
 * nothing: what it installs is a listener React looks for, not a wrapper around
 * something the app calls.
 */

import { clearInspectedElement } from './store/inspection';
import {
  installDevToolsHookShim,
  uninstallDevToolsHookShim,
} from './devtools-hook';

export function installElementInspector(): () => void {
  // The one thing that must happen *now* rather than at first use: React reads
  // __REACT_DEVTOOLS_GLOBAL_HOOK__ when its renderer module is first required,
  // which is lazy on the first render (`RendererImplementation.js`). Install runs
  // at module scope, so this is inside that window — a moment later and React
  // would already have looked and found nothing.
  //
  // No-ops when a hook already exists (React DevTools, RN's dev setup) — both are
  // strictly better than ours, so they win and there is nothing to uninstall.
  const installedHook = installDevToolsHookShim();

  // Everything else is deliberately deferred. Capture happens lazily via the
  // picker, and we don't probe the renderer API here because renderers only
  // register with the hook after the first commit — always after this runs.
  // Availability is checked at first use instead. The inspected element is
  // dropped on teardown so it can't outlive the session.
  return () => {
    clearInspectedElement();
    if (installedHook) {
      uninstallDevToolsHookShim();
    }
  };
}
