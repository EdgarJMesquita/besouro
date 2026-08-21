/** One directory or file as a grid tile. */

import { memo, useCallback } from 'react';
import { Image, Pressable, Text } from 'react-native';
import type { DirectoryEntry } from '../types';

import { classifyFile, toFileUri } from '../utils/file-types';

import { useBesouroUI } from '../../../shared/context';

import { Icon } from '../../../shared/components/Icon';

import { space, fontSize, radius } from '../../../theme/tokens';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

/** Columns in grid mode — cells are `100 / GRID_COLUMNS`% wide. */
export const GRID_COLUMNS = 3;

/**
 * A single grid cell — a large folder/file glyph (or image thumbnail) over a
 * centered, two-line name. Cells tile `GRID_COLUMNS` across via a percentage
 * width so partial final rows keep their column width instead of stretching.
 */
export const GridCell = memo(function GridCell({
  entry,
  onSelect,
}: {
  entry: DirectoryEntry;
  onSelect: (entry: DirectoryEntry) => void;
}): React.ReactNode {
  const s = useStyles();
  const handlePress = useCallback(() => onSelect(entry), [onSelect, entry]);
  const { theme } = useBesouroUI();
  const isImage = !entry.isDirectory && classifyFile(entry.name) === 'image';
  return (
    <Pressable
      onPress={handlePress}
      style={{
        width: `${100 / GRID_COLUMNS}%`,
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.xl,
        paddingHorizontal: space.sm,
      }}
    >
      {isImage ? (
        <Image
          source={{ uri: toFileUri(entry.path) }}
          resizeMode="cover"
          style={s.surface}
        />
      ) : (
        <Icon
          name={entry.isDirectory ? 'folder' : 'file'}
          size={40}
          color={entry.isDirectory ? theme.accent : theme.textMuted}
        />
      )}
      <Text numberOfLines={2} ellipsizeMode="middle" style={s.label}>
        {entry.name}
      </Text>
    </Pressable>
  );
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.text,
          fontSize: font(fontSize.caption),
          textAlign: 'center',
        },
        surface: {
          width: 44,
          height: 44,
          borderRadius: radius.md,
          backgroundColor: theme.surfaceRaised,
        },
      }),
    [theme, font]
  );
}
