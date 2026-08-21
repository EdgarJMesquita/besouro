/** One directory or file in the list view. */

import { memo, useCallback } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { DirectoryEntry } from '../types';

import { classifyFile, formatDateTime, toFileUri } from '../utils/file-types';
import { formatBytes } from '../../../shared/utils/bytes-format';

import { useBesouroUI } from '../../../shared/context';

import { Icon } from '../../../shared/components/Icon';

import { space, fontSize } from '../../../theme/tokens';
import { layout } from '../../../shared/styles';
import { useTextStyles } from '../../../shared/hooks/text-styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export const EntryRow = memo(function EntryRow({
  entry,
  onSelect,
}: {
  entry: DirectoryEntry;
  onSelect: (entry: DirectoryEntry) => void;
}): React.ReactNode {
  const s = useStyles();
  const text = useTextStyles();
  const handlePress = useCallback(() => onSelect(entry), [onSelect, entry]);
  const { theme } = useBesouroUI();
  // Image files get a real thumbnail in place of the generic file glyph, so the
  // list previews its contents at a glance.
  const isImage = !entry.isDirectory && classifyFile(entry.name) === 'image';
  return (
    <Pressable onPress={handlePress} style={s.row}>
      {isImage ? (
        <Image
          source={{ uri: toFileUri(entry.path) }}
          resizeMode="cover"
          style={s.surface}
        />
      ) : (
        <Icon
          name={entry.isDirectory ? 'folder' : 'file'}
          size={18}
          color={entry.isDirectory ? theme.accent : theme.textMuted}
        />
      )}
      <View style={layout.fill}>
        <Text style={text.base} numberOfLines={1}>
          {entry.name}
        </Text>
        {!entry.isDirectory ? (
          <Text style={s.label2}>
            {`${formatBytes(entry.sizeBytes)} · ${formatDateTime(entry.modifiedAt)}`}
          </Text>
        ) : null}
      </View>
      {entry.isDirectory ? <Text style={s.label}>›</Text> : null}
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
          color: theme.textMuted,
          fontSize: 18,
        },
        label2: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          marginTop: 2,
        },
        surface: {
          width: 28,
          height: 28,
          borderRadius: 4,
          backgroundColor: theme.surfaceRaised,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.lg,
          paddingVertical: space.xl,
          paddingHorizontal: space.lg,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
      }),
    [theme, font]
  );
}
