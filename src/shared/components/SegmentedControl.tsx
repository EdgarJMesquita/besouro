/**
 * Horizontal single-choice control with text labels — the wording counterpart to
 * the File System browser's icon toggle (`ViewModeToggle`), and styled to match
 * it: one bordered pill, the active segment raised and tinted with the accent
 * the way Settings marks its selected option.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useBesouroUI } from '../context';
import { space, radius, fontSize, fontWeight } from '../../theme/tokens';

export function SegmentedControl<Option extends string>({
  options,
  selected,
  onSelect,
  labelFor,
}: {
  options: readonly Option[];
  selected: Option;
  onSelect: (option: Option) => void;
  labelFor?: (option: Option) => string;
}): React.ReactNode {
  const s = useStyles();
  const { theme, font } = useBesouroUI();
  return (
    <View style={s.row}>
      {options.map((option) => {
        const active = option === selected;
        return (
          <Pressable
            key={option}
            onPress={() => onSelect(option)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{
              paddingHorizontal: space.xl,
              justifyContent: 'center',
              backgroundColor: active ? theme.surfaceRaised : 'transparent',
            }}
          >
            <Text
              style={{
                color: active ? theme.accent : theme.textMuted,
                fontSize: font(fontSize.body),
                fontWeight: active ? fontWeight.bold : fontWeight.medium,
              }}
            >
              {labelFor ? labelFor(option) : option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Theme-derived styles for this module, memoized per theme. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          // Sized to its labels, so a two-option control doesn't span the drawer.
          alignSelf: 'flex-start',
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
