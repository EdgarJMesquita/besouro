/** An editable prop row — commits a coerced value back to the live element. */

import { useState } from 'react';
import { View } from 'react-native';

import { asColor } from '../utils/color';
import { coerce } from '../utils/coerce';
import { valuesFor } from '../utils/suggest';
import { SuggestInput } from './SuggestInput';
import { ColorSwatch } from './ColorSwatch';
import { PropName } from './PropName';
import { RemovePropButton } from './RemovePropButton';
import { propRowStyle } from '../styles';

export function EditablePropRow({
  name,
  value,
  commit,
  onRemove,
}: {
  name: string;
  value: string | number;
  commit: (value: unknown) => void;
  /** Drop the prop entirely. Absent when the element is read-only. */
  onRemove?: () => void;
}): React.ReactNode {
  const [text, setText] = useState(String(value));
  const isNumber = typeof value === 'number';
  // Preview what's *typed*, so the swatch tracks the edit rather than the last
  // committed value. The slot stays once a row is known to hold a color, so a
  // half-typed hex empties the square instead of removing it.
  const typedColor = asColor(text);
  const isColorRow = typedColor !== null || asColor(value) !== null;

  const onCommit = () => commit(coerce(value, text));

  return (
    <View style={propRowStyle}>
      <PropName name={name} />
      {isColorRow ? <ColorSwatch color={typedColor} /> : null}
      <SuggestInput
        value={text}
        onChangeText={setText}
        onSelect={(suggestion) => {
          setText(suggestion);
          commit(coerce(value, suggestion));
        }}
        onEndEditing={onCommit}
        onSubmitEditing={onCommit}
        suggestions={valuesFor(name)}
        showAllOnFocus
        keyboardType={isNumber ? 'numeric' : 'default'}
        flex={1}
      />
      {onRemove ? <RemovePropButton name={name} onPress={onRemove} /> : null}
    </View>
  );
}
