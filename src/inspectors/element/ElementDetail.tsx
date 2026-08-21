/**
 * Element detail screen — the inspected component's hierarchy, source, and live
 * editable props.
 */

import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { overrideInspectedProp, removeInspectedProp } from './store/inspection';
import type { InspectedElement } from './types';

import { useBesouroUI } from '../../shared/context';
import { CopyButton } from '../../shared/components/CopyButton';
import { KeyboardAwareView } from '../../shared/components/KeyboardAwareView';
import { KeyValueRow } from '../../shared/components/KeyValueRow';
import { MonoText } from '../../shared/components/MonoText';
import { SectionHeader } from '../../shared/components/SectionHeader';

import { space, fontSize, fontWeight } from '../../theme/tokens';
import { useBottomInset } from '../../shared/hooks/safe-area';
import { round } from './utils/coerce';
import { STYLE_KEYS, COMMON_PROP_KEYS } from './data/prop-keys';
import { PropRow } from './components/PropRow';
import { AddRow } from './components/AddRow';
import { BoxModel } from './components/BoxModel';
import { rowStyle, flexOne } from './styles';
import { useMemo } from 'react';

export function ElementDetail({
  element,
}: {
  element: InspectedElement;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const bottomInset = useBottomInset();
  // `style` gets its own editable section; skip it (and undefined noise) in props.
  // `children` leads: it is what identifies the element on sight, and it is the
  // one prop with no remove button, so it reads as a heading rather than a gap in
  // an otherwise uniform list.
  const propEntries = useMemo(
    () =>
      Object.entries(element.props)
        .filter(([name, value]) => value !== undefined && name !== 'style')
        .sort(([a], [b]) => (a === 'children' ? -1 : b === 'children' ? 1 : 0)),
    [element.props]
  );
  // RN styles are usually an array — flatten to a single editable object. Edits
  // (and additions) commit by overriding the whole `style` prop with the merged
  // flat object. Defaults to `{}` so a style can be added to an element with none.
  const styleBase = useMemo(
    () =>
      (StyleSheet.flatten(element.props.style as StyleProp<TextStyle>) as
        Record<string, unknown> | undefined) ?? {},
    [element.props.style]
  );
  const styleEntries = Object.entries(styleBase);

  return (
    <KeyboardAwareView>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: space.xl + bottomInset,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.label}>{element.componentName}</Text>

        {/* Carried by native picks, where the class name alone ("ReactViewGroup")
            says nothing about which element this is. */}
        {element.testID ? (
          <KeyValueRow label="testID" value={element.testID} />
        ) : null}

        {element.frame ? (
          <>
            <SectionHeader title={strings.boxModel} />
            {/* Size lives in the diagram's centre box, so it gets no row of its
                own; position has nowhere to be drawn and keeps one. */}
            <BoxModel frame={element.frame} style={styleBase} />
            <KeyValueRow
              label={strings.position}
              value={`${round(element.frame.left)}, ${round(element.frame.top)}`}
              copyable={false}
            />
          </>
        ) : null}

        {element.source ? (
          <>
            <SectionHeader title={strings.source} />
            <View style={rowStyle}>
              <MonoText style={flexOne} color={theme.textMuted}>
                {element.source}
              </MonoText>
              <CopyButton value={element.source} />
            </View>
          </>
        ) : null}

        <SectionHeader title={strings.hierarchy} />
        <MonoText color={theme.textMuted}>
          {element.hierarchy.join(' › ')}
        </MonoText>

        {/* A native pick has no props to show or edit, so the props and style
            sections are dropped entirely rather than rendered empty — two blank
            editors with an "Add" button would read as a bug, and anything typed
            into them would silently do nothing. */}
        {element.origin === 'native' ? (
          <>
            <SectionHeader title={strings.props} />
            <Text style={s.notice}>{strings.elementNativeOnly}</Text>
            {Platform.OS === 'android' && <View style={styles.box} />}
          </>
        ) : (
          <PropSections
            element={element}
            propEntries={propEntries}
            styleBase={styleBase}
            styleEntries={styleEntries}
            // A fiber-resolved element has real props but no `overrideProps` to
            // write them through, so it's a viewer, not an editor.
            readOnly={element.origin === 'fiber'}
          />
        )}
      </ScrollView>
    </KeyboardAwareView>
  );
}

/**
 * The props and style sections, for elements that have React props at all.
 *
 * Writing needs the reconciler: only `overrideProps` can change an `onPress`, a
 * `children` or a `style`, and a release build ships no dev renderer to provide it.
 * So an element resolved from a fiber shows everything and edits nothing — the
 * rows render as static previews and the "Add" rows go away, since a value typed
 * into either would have nowhere to go.
 */
function PropSections({
  element,
  propEntries,
  styleBase,
  styleEntries,
  readOnly,
}: {
  element: InspectedElement;
  propEntries: Array<[string, unknown]>;
  styleBase: Record<string, unknown>;
  styleEntries: Array<[string, unknown]>;
  readOnly: boolean;
}): React.ReactNode {
  const s = useStyles();
  const { strings } = useBesouroUI();
  return (
    <>
      <SectionHeader title={strings.props} />
      {readOnly ? (
        <Text style={s.notice}>{strings.elementReadOnlyProps}</Text>
      ) : null}
      {propEntries.map(([name, value]) => (
        // Key by component + prop so switching elements remounts each editor.
        <PropRow
          key={`${element.componentName}:${name}`}
          name={name}
          value={value}
          readOnly={readOnly}
          commit={(next) => overrideInspectedProp([name], next)}
          // `children` is the one prop that can't be typed back in: its value is
          // a React element, and the Add row only produces strings, numbers and
          // booleans. Removing it would blank the component with no way back
          // short of re-picking it.
          onRemove={
            readOnly || name === 'children'
              ? undefined
              : () => removeInspectedProp([name])
          }
        />
      ))}
      {readOnly ? null : (
        <AddRow
          // Suggest keys that aren't actually set — RN lists many props as
          // `undefined`, so check the value, not mere key presence.
          suggestions={COMMON_PROP_KEYS.filter(
            (k) => element.props[k] === undefined
          )}
          onAdd={(name, value) => overrideInspectedProp([name], value)}
        />
      )}

      <SectionHeader title={strings.styleLabel} />
      {styleEntries.map(([name, value]) => (
        <PropRow
          key={`${element.componentName}:style:${name}`}
          name={name}
          value={value}
          readOnly={readOnly}
          // Merge back into the whole style prop — paths into a style array
          // are brittle, so we override `style` with the edited flat object.
          commit={(next) =>
            overrideInspectedProp(['style'], { ...styleBase, [name]: next })
          }
          // Removing a style entry means overriding `style` with the flattened
          // object minus the key — the same whole-prop write every style edit
          // uses, since paths into a style array are brittle.
          onRemove={
            readOnly
              ? undefined
              : () => {
                  const rest = { ...styleBase };
                  delete rest[name];
                  overrideInspectedProp(['style'], rest);
                }
          }
        />
      ))}
      {readOnly ? null : (
        <AddRow
          suggestions={STYLE_KEYS.filter((k) => styleBase[k] === undefined)}
          onAdd={(name, value) =>
            overrideInspectedProp(['style'], { ...styleBase, [name]: value })
          }
        />
      )}
      {Platform.OS === 'android' && <View style={styles.box} />}
    </>
  );
}

const styles = StyleSheet.create({
  box: {
    height: space.lg,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.text,
          fontSize: font(fontSize.lg),
          fontWeight: fontWeight.bold,
        },
        // Explains why the props section is empty on a native-only pick.
        notice: {
          color: theme.textMuted,
          fontSize: font(fontSize.body),
        },
      }),
    [theme, font]
  );
}
