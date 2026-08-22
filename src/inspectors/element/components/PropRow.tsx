/** One prop of the inspected element; expands into an editor when tapped. */

import { Switch, View } from 'react-native';

import { useBesouroUI } from '../../../shared/context';

import { MonoText } from '../../../shared/components/MonoText';

import { fontSize } from '../../../theme/tokens';

import { propPreview } from '../utils/preview';
import { asColor } from '../utils/color';
import { ColorSwatch } from './ColorSwatch';
import { PropName } from './PropName';
import { EditablePropRow } from './EditablePropRow';
import { RemovePropButton } from './RemovePropButton';
import { propRowStyle, flexOne } from '../styles';

/** One editable field — for a prop or a flattened style entry. Primitives edit
 *  inline; anything else is a read-only preview. `commit` applies the new value. */
export function PropRow({
  name,
  value,
  commit,
  onRemove,
  readOnly = false,
}: {
  name: string;
  value: unknown;
  commit: (value: unknown) => void;
  /** Drop the prop entirely. Absent when the element is read-only. */
  onRemove?: () => void;
  /**
   * Render every value as a static preview, editors included. Set for elements
   * resolved from a fiber rather than the dev renderer: the props are real, but
   * there's no `overrideProps` to write them back through, and an editable-looking
   * field that silently discards input is worse than an honest read-only one.
   */
  readOnly?: boolean;
}): React.ReactNode {
  const { theme } = useBesouroUI();

  if (!readOnly && typeof value === 'boolean') {
    return (
      <View style={propRowStyle}>
        <PropName name={name} />
        <Switch value={value} onValueChange={(next) => commit(next)} />
        {onRemove ? <RemovePropButton name={name} onPress={onRemove} /> : null}
      </View>
    );
  }

  if (!readOnly && (typeof value === 'string' || typeof value === 'number')) {
    return (
      <EditablePropRow
        name={name}
        value={value}
        commit={commit}
        onRemove={onRemove}
      />
    );
  }

  const preview = propPreview(value);
  // The read-only path is all a release build gets — no dev renderer, so every
  // value renders here. A color still shows as a color.
  const color = asColor(value);
  return (
    <View style={propRowStyle}>
      <PropName name={name} />
      {color ? <ColorSwatch color={color} /> : null}
      <MonoText style={flexOne} color={theme.textMuted} size={fontSize.caption}>
        {preview}
      </MonoText>
      {onRemove ? <RemovePropButton name={name} onPress={onRemove} /> : null}
    </View>
  );
}
