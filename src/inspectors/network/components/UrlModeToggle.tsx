/**
 * Cycles how a request URL is displayed in the list: last segment, path, or the
 * full URL. The choice persists across launches.
 */

import { useCallback } from 'react';

import { Pressable, View } from 'react-native';

import { useBesouroUI } from '../../../shared/context';

import { space } from '../../../theme/tokens';

import { Icon, type IconName } from '../../../shared/components/Icon';

import { type UrlMode } from '../format';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

const URL_MODE_ORDER: readonly UrlMode[] = ['last', 'path', 'full'];

/**
 * The stacked-line glyph aligns to hint how much of the URL is shown: the last
 * segment sits at the end (right), the full URL at the start (left).
 */
const URL_MODE_ICON: Record<UrlMode, IconName> = {
  last: 'align-right',
  path: 'align-center',
  full: 'align-left',
};

/**
 * A single icon button cycling the URL display mode (last segment → path → full
 * URL). The stacked lines align right/center/left to hint how much is shown.
 */
export function UrlModeToggle({
  value,
  onChange,
}: {
  value: UrlMode;
  onChange: (mode: UrlMode) => void;
}): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();

  const onPressed = useCallback(() => {
    const count = URL_MODE_ORDER.length;
    const next = URL_MODE_ORDER[(URL_MODE_ORDER.indexOf(value) + 1) % count];
    if (next) {
      onChange(next);
    }
  }, [onChange, value]);

  return (
    <View style={s.row}>
      <Pressable
        onPress={onPressed}
        accessibilityRole="button"
        style={s.surface}
      >
        <Icon name={URL_MODE_ICON[value]} size={18} color={theme.textMuted} />
      </Pressable>
    </View>
  );
}

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        surface: {
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          backgroundColor: theme.surfaceRaised,
        },
        row: {
          flexDirection: 'row',
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 6,
          overflow: 'hidden',
        },
      }),
    [theme]
  );
}
