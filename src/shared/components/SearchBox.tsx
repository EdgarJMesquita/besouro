/**
 * Per-tab search box — a debounced-feeling, controlled text input with a
 * View-composed search icon. Case-insensitive substring filtering is applied by
 * the caller against that inspector's relevant fields (§7).
 */

import { TextInput, View } from 'react-native';
import { useBesouroUI } from '../context';
import { Icon } from './Icon';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

interface SearchBoxProps {
  value: string;
  onChangeText: (text: string) => void;
}

export function SearchBox({
  value,
  onChangeText,
}: SearchBoxProps): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  return (
    <View style={s.row}>
      <Icon name="search" size={14} color={theme.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={strings.search}
        placeholderTextColor={theme.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        style={s.label}
      />
    </View>
  );
}

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          flex: 1,
          color: theme.text,
          fontSize: 13,
          padding: 0,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 8,
          height: 34,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 6,
          backgroundColor: theme.surfaceRaised,
          flex: 1,
        },
      }),
    [theme]
  );
}
