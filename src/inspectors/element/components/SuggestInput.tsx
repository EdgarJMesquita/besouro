/** Autocompleting text input used when editing or adding a prop. */

import { useState } from 'react';
import { Pressable, Text, TextInput, View, type TextStyle } from 'react-native';

import { useBesouroUI } from '../../../shared/context';

import { space, radius, fontSize } from '../../../theme/tokens';

import { asColor } from '../utils/color';
import { matchKeys } from '../utils/suggest';
import { ColorSwatch } from './ColorSwatch';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

/**
 * A text field with a suggestions dropdown that drops beneath it (a combobox).
 * Options come from `suggestions`, filtered by the typed text; with
 * `showAllOnFocus` the full (short) list shows on focus. The dropdown is
 * absolutely positioned and elevated so it overlays the rows below instead of
 * pushing them down. Tapping an option calls `onSelect`.
 */
export function SuggestInput({
  value,
  onChangeText,
  onSelect,
  onEndEditing,
  onSubmitEditing,
  suggestions,
  showAllOnFocus = false,
  placeholder,
  keyboardType = 'default',
  flex,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSelect: (item: string) => void;
  onEndEditing?: () => void;
  onSubmitEditing?: () => void;
  suggestions: string[];
  showAllOnFocus?: boolean;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  flex: number;
}): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  const fieldStyle = useFieldStyle();
  const [focused, setFocused] = useState(false);
  const matches = focused ? matchKeys(suggestions, value, showAllOnFocus) : [];
  const open = matches.length > 0;

  // On edit-end, if typing has narrowed the list to a single option, pick it
  // (e.g. `flex-s` → `flex-start`); otherwise commit what was typed.
  const onEnd = () => {
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only != null && only !== value) {
      onSelect(only);
    } else {
      onEndEditing?.();
    }
  };

  return (
    <View style={{ flex, position: 'relative', zIndex: open ? 10 : 0 }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        // Delay so a tap on a dropdown row lands before it unmounts.
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        onEndEditing={onEnd}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={theme.textFaint}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={fieldStyle(1)}
      />
      {open ? (
        // Rendered above the input, sized to its content (no inner scroll).
        <View
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: space.xs,
            backgroundColor: theme.surfaceRaised,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: radius.md,
            overflow: 'hidden',
            zIndex: 999,
            elevation: 24,
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
          }}
        >
          {matches.map((item, index) => (
            <Pressable
              key={item}
              onPress={() => onSelect(item)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingVertical: space.md,
                paddingHorizontal: space.md,
                backgroundColor: pressed ? theme.surface : 'transparent',
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.border,
              })}
            >
              {/* The color suggestions are a list of names; picking from it goes
                  much faster when the names come with the colors attached. */}
              {asColor(item) ? <ColorSwatch color={item} /> : null}
              <Text style={s.label}>{item}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** Shared style for the inline monospace edit fields. */
export function useFieldStyle(): (flex: number) => TextStyle {
  const { theme, font } = useBesouroUI();
  return (flex) => ({
    flex,
    color: theme.text,
    fontFamily: 'Courier',
    fontSize: font(fontSize.caption),
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.sm,
    backgroundColor: theme.surfaceRaised,
  });
}

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.text,
          fontFamily: 'Courier',
          fontSize: fontSize.caption,
        },
      }),
    [theme]
  );
}
