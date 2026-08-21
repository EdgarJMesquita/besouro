/**
 * Element tab — shows the **one** currently inspected element (like Chrome / RN
 * DevTools), not a capture history. "Inspect" starts a native tap-to-pick; the
 * resolved element shows its hierarchy, native tag, box model, source, and props.
 * Primitive props and flattened style entries are editable inline and pushed live
 * via `overrideInspectedProp`. Edits are ephemeral — React re-applies the original
 * props on the next render (the same "live experiment" model as Chrome DevTools).
 */

import { Text, View } from 'react-native';
import {
  startElementPick,
  isElementInspectorAvailable,
  isFullInspectionAvailable,
} from './picker';
import { useInspectedElement, clearInspectedElement } from './store/inspection';

import { useBesouroUI } from '../../shared/context';

import { TextButton } from '../../shared/components/TextButton';
import { space, fontSize } from '../../theme/tokens';

import { ElementDetail } from './ElementDetail';
import { layout } from '../../shared/styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function ElementTab(): React.ReactNode {
  const s = useStyles();
  const { strings } = useBesouroUI();
  const element = useInspectedElement();

  // Nothing inspected yet — a centered call-to-action. The pick itself only needs
  // the native module, so it's offered in release builds too; the hint says up
  // front how much detail to expect, since a release pick resolves to the native
  // view tree rather than React components.
  if (!element) {
    const canPick = isElementInspectorAvailable();
    // `canPick` is false only when the native module is missing — in which case
    // this drawer, itself a native-injected surface, wouldn't be on screen. So the
    // message only has to distinguish full from native-only detail.
    const full = canPick && isFullInspectionAvailable();
    return (
      <View style={styles.container}>
        {canPick ? (
          <TextButton
            label={strings.inspectElement}
            tone="accent"
            onPress={startElementPick}
          />
        ) : null}
        <Text style={s.label}>
          {full ? strings.elementPickHint : strings.elementDevOnly}
        </Text>
      </View>
    );
  }

  return (
    <View style={layout.fill}>
      <View style={s.row}>
        <TextButton
          label={strings.inspectElement}
          tone="accent"
          onPress={startElementPick}
          style={layout.fill}
        />
        <TextButton
          label={strings.clear}
          plain
          onPress={clearInspectedElement}
        />
      </View>
      <ElementDetail element={element} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
    padding: 32,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: space.md,
          paddingVertical: space.md,
          paddingHorizontal: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
        label: {
          color: theme.textMuted,
          fontSize: fontSize.base,
          textAlign: 'center',
          maxWidth: 200,
        },
      }),
    [theme]
  );
}
