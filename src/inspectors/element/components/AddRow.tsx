/** The "add a prop" row at the foot of the prop list. */

import { useState } from 'react';
import { View } from 'react-native';

import { useBesouroUI } from '../../../shared/context';

import { TextButton } from '../../../shared/components/TextButton';

import { asColor } from '../utils/color';
import { coerceInput } from '../utils/coerce';
import { valuesFor } from '../utils/suggest';
import { SuggestInput } from './SuggestInput';
import { ColorSwatch } from './ColorSwatch';
import { propRowStyle } from '../styles';

/**
 * Add a brand-new prop or style entry: a name + value field and an Add button.
 * The key field autocompletes from `suggestions`; the value field suggests enum /
 * color / boolean options for the entered key. The value is type-inferred
 * (`true`/`false` → boolean, numeric → number, else string). Clears on submit so
 * several can be added in a row.
 */
export function AddRow({
  onAdd,
  suggestions = [],
}: {
  onAdd: (name: string, value: unknown) => void;
  suggestions?: string[];
}): React.ReactNode {
  const { strings } = useBesouroUI();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  // Only once the typed value is a color — there's no committed value here to
  // hold the slot open, so an always-present empty square would just be noise.
  const color = asColor(value);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    onAdd(trimmed, coerceInput(value));
    setName('');
    setValue('');
  };

  return (
    <View style={propRowStyle}>
      <SuggestInput
        value={name}
        onChangeText={setName}
        onSelect={setName}
        suggestions={suggestions}
        placeholder={strings.key}
        flex={0.5}
      />
      {color ? <ColorSwatch color={color} /> : null}
      <SuggestInput
        value={value}
        onChangeText={setValue}
        onSelect={setValue}
        onSubmitEditing={submit}
        suggestions={valuesFor(name)}
        showAllOnFocus
        placeholder={strings.value}
        flex={1}
      />
      <TextButton
        label={strings.addLabel}
        tone="accent"
        plain
        onPress={submit}
      />
    </View>
  );
}
