/**
 * Detail-overlay navigation. Detail views render over the whole drawer (covering
 * the tab bar) instead of inside the tab body. Each open detail level registers a
 * "close" with this controller so the drawer can (a) elevate its content to a
 * full-cover overlay while any level is open and (b) route the Android hardware
 * back button to close the top-most level before closing the drawer.
 *
 * Levels form a stack, so nested details (e.g. Socket client → frame) pop one at
 * a time.
 *
 * This is the navigation half only — the surface a detail renders into is
 * `shared/components/DetailOverlay`, which registers itself here.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface DetailNav {
  /** Register an open detail level; returns an unregister to call on close. */
  register: (close: () => void) => () => void;
}

const DetailNavContext = createContext<DetailNav | null>(null);

export interface DetailNavController {
  Provider: (props: { value: DetailNav; children: ReactNode }) => ReactNode;
  nav: DetailNav;
  /** Number of open detail levels; > 0 means the overlay should cover the drawer. */
  depth: number;
  /** Close the top-most detail level. Returns whether one was open. */
  closeTop: () => boolean;
}

/** Shell-side controller: owns the level stack and exposes depth + back handling. */
export function useDetailNavController(): DetailNavController {
  const closers = useRef<Array<() => void>>([]);
  const [depth, setDepth] = useState(0);

  const register = useCallback((close: () => void): (() => void) => {
    closers.current.push(close);
    setDepth(closers.current.length);
    return () => {
      const index = closers.current.lastIndexOf(close);
      if (index >= 0) {
        closers.current.splice(index, 1);
        setDepth(closers.current.length);
      }
    };
  }, []);

  const closeTop = useCallback((): boolean => {
    const top = closers.current[closers.current.length - 1];
    if (top) {
      top();
      return true;
    }
    return false;
  }, []);

  const nav = useMemo<DetailNav>(() => ({ register }), [register]);

  return {
    Provider: DetailNavContext.Provider as DetailNavController['Provider'],
    nav,
    depth,
    closeTop,
  };
}

/**
 * Tab-side hook: mark a detail level open while `active` is true, wiring its
 * `close` into the shared stack. Safe to call unconditionally.
 */
export function useDetailLevel(active: boolean, close: () => void): void {
  const nav = useContext(DetailNavContext);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!nav || !active) {
      return;
    }
    return nav.register(() => closeRef.current());
  }, [nav, active]);
}
