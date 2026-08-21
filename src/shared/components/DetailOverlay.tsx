/**
 * Detail overlay — the full-cover surface a detail view renders into, plus the
 * context that exposes its animated close to {@link BackButton}.
 *
 * The navigation half (the level stack, Android back routing, tab-bar hiding)
 * lives in `shared/detail-nav`; this module is only the presentation.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { Animated } from 'react-native';
import { useBesouroUI } from '../context';
import { useDetailLevel } from '../detail-nav';
import { useDetailSlide } from '../hooks/detail-slide';

const DetailBackContext = createContext<(() => void) | null>(null);

/** The animated close for the nearest enclosing DetailOverlay, if any. */
export function useDetailBack(): (() => void) | null {
  return useContext(DetailBackContext);
}

/**
 * Wraps a detail view as an opaque overlay that slides in from the right on
 * mount and slides back out before unmounting — the same motion as the drawer
 * drawer sliding over the app. Because it's an absolute-fill overlay, the list
 * it covers stays mounted underneath (keeping its scroll position and state)
 * rather than being swapped out.
 *
 * Render it as a sibling of the content it covers, gated on the selected id:
 *
 *   <View style={layout.fill}>
 *     {list}
 *     {selected ? (
 *       <DetailOverlay onClose={() => setSelectedId(null)}>
 *         <XDetail ... />
 *       </DetailOverlay>
 *     ) : null}
 *   </View>
 *
 * Owns this level's detail-nav registration (Android back + tab-bar hiding), so
 * the hosting tab must NOT also call `useDetailLevel` for the same level.
 * `onClose` runs once the slide-out finishes to unmount the detail. The animated
 * close is exposed via context and consumed by {@link BackButton} when it has no
 * explicit `onPress`.
 *
 * A host whose selection comes from the ephemeral store should pass
 * `animateIn={useDetailEntrance(selectedId)}`, so a detail that is merely
 * restored when the tab remounts appears in place instead of sliding in on its
 * own. Details opened from plain `useState` can leave it at the default: that
 * state resets on remount, so they only ever appear from a tap.
 */
export function DetailOverlay({
  onClose,
  animateIn = true,
  children,
}: {
  onClose: () => void;
  animateIn?: boolean;
  children: ReactNode;
}): ReactNode {
  const { theme } = useBesouroUI();
  const { translateX, requestClose } = useDetailSlide(onClose, animateIn);

  // This level owns its registration: Android back triggers the same slide-out,
  // and the drawer hides its tab bar while any level is open.
  useDetailLevel(true, requestClose);

  return (
    <DetailBackContext.Provider value={requestClose}>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          // Above the list it covers, and opaque so that list can't show through
          // during the slide.
          zIndex: 10,
          backgroundColor: theme.background,
          transform: [{ translateX }],
        }}
      >
        {children}
      </Animated.View>
    </DetailBackContext.Provider>
  );
}
