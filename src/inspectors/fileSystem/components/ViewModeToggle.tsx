/** Switches the browser between list and grid layout; the choice persists. */

import { Pressable, View } from 'react-native';

import { useBesouroUI } from '../../../shared/context';

import { Icon } from '../../../shared/components/Icon';

import { space, radius } from '../../../theme/tokens';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

/** The two ways the current directory can be laid out. */
export type ViewMode = 'list' | 'grid';

const VIEW_MODES: readonly ViewMode[] = ['list', 'grid'];

/**
 * A segmented control switching between list and grid layouts: both glyphs are
 * shown side by side, and the active segment is highlighted with a raised
 * "thumb" and accent-colored icon.
 */
export function ViewModeToggle({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  return (
    <View style={s.row}>
      {VIEW_MODES.map((mode) => {
        const active = mode === value;
        return (
          <Pressable
            key={mode}
            onPress={() => onChange(mode)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${mode} view`}
            style={{
              paddingHorizontal: space.lg,
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: active ? theme.surfaceRaised : 'transparent',
            }}
          >
            <Icon name={mode} color={active ? theme.accent : theme.textMuted} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          height: 34,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: radius.md,
          overflow: 'hidden',
        },
      }),
    [theme]
  );
}
