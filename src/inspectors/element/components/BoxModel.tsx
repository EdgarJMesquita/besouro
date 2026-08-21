/**
 * Box-model diagram — the element's frame at the centre, wrapped in a padding
 * ring and a margin ring, drawn with plain nested views the way RN's own
 * inspector draws it.
 *
 * The rings come from the *declared style*, not from measured layout: nothing on
 * either pick path reports resolved padding, and a ring is only drawn when the
 * style actually declares that property, so an element with no padding shows the
 * frame alone rather than a box of zeros.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MonoText } from '../../../shared/components/MonoText';
import { useBesouroUI } from '../../../shared/context';
import { withAlpha } from '../../../shared/utils/with-alpha';
import { fontSize, fontWeight, radius, space } from '../../../theme/tokens';
import type { ElementFrame } from '../types';
import { round } from '../utils/coerce';
import { resolveBoxStyle, type BoxEdges } from '../utils/box-style';

export function BoxModel({
  frame,
  style,
}: {
  frame: ElementFrame;
  /** The element's flattened style — empty for a native pick, which has none. */
  style: Record<string, unknown>;
}): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  const margin = useMemo(() => resolveBoxStyle('margin', style), [style]);
  const padding = useMemo(() => resolveBoxStyle('padding', style), [style]);

  let box: React.ReactNode = (
    <View
      style={[
        s.frame,
        {
          borderColor: theme.accent,
          backgroundColor: withAlpha(theme.accent, 0.12),
        },
      ]}
    >
      <MonoText size={fontSize.caption}>
        {`${round(frame.width)} × ${round(frame.height)}`}
      </MonoText>
    </View>
  );

  if (padding) {
    box = (
      <Ring label="padding" color={theme.success} edges={padding}>
        {box}
      </Ring>
    );
  }
  if (margin) {
    box = (
      <Ring label="margin" color={theme.warning} edges={margin}>
        {box}
      </Ring>
    );
  }

  return <View style={styles.container}>{box}</View>;
}

/**
 * One labelled ring: its four edge values around whatever it wraps.
 *
 * The corner label is positioned absolutely so it costs no layout space: reserving
 * a row for it at the top and nothing at the bottom is what pushes the whole ring
 * off-centre. It shares the top edge value's row and simply sits to its left — the
 * value is centred over the content, the label hugs the corner.
 */
function Ring({
  label,
  color,
  edges,
  children,
}: {
  label: string;
  color: string;
  edges: BoxEdges;
  children: React.ReactNode;
}): React.ReactNode {
  const s = useStyles();
  return (
    <View
      style={[
        s.ring,
        {
          borderColor: withAlpha(color, 0.5),
          backgroundColor: withAlpha(color, 0.1),
        },
      ]}
    >
      <Text style={[s.ringLabel, { color }]}>{label}</Text>
      <Edge value={edges.top} />
      <View style={styles.middle}>
        <Edge value={edges.left} />
        {children}
        <Edge value={edges.right} />
      </View>
      <Edge value={edges.bottom} />
    </View>
  );
}

/** A single edge value. Numbers are rounded; `'50%'` and friends pass through. */
function Edge({ value }: { value: number | string }): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  return (
    <MonoText size={fontSize.micro} color={theme.textMuted} style={s.edge}>
      {typeof value === 'number' ? String(round(value)) : value}
    </MonoText>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: space.md,
  },
  middle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        ring: {
          borderWidth: 1,
          borderRadius: radius.md,
          padding: space.sm,
          alignItems: 'center',
          gap: space.xs,
        },
        ringLabel: {
          position: 'absolute',
          top: space.tight,
          left: space.sm,
          fontSize: font(fontSize.micro),
          fontWeight: fontWeight.medium,
        },
        edge: {
          minWidth: 20,
          textAlign: 'center',
        },
        frame: {
          borderWidth: 1,
          borderRadius: radius.sm,
          paddingVertical: space.md,
          paddingHorizontal: space.xl,
        },
      }),
    [font]
  );
}
