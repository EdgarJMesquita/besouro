/**
 * File detail screen — metadata for one path plus a bounded text preview, with
 * share and copy affordances.
 */

import { useEffect, useState } from 'react';

import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type { DirectoryEntry, FileMetadata, FileSystemBrowser } from './types';
import { classifyFile, formatDateTime, toFileUri } from './utils/file-types';
import { extensionOf } from '../../shared/utils/mime-types';
import { formatBytes } from '../../shared/utils/bytes-format';
import { isShareAvailable, shareFile } from '../../core/share';
import { useBesouroUI } from '../../shared/context';

import { Icon } from '../../shared/components/Icon';

import { BackButton } from '../../shared/components/BackButton';

import { KeyValueRow } from '../../shared/components/KeyValueRow';
import { MonoText } from '../../shared/components/MonoText';
import { space, fontSize } from '../../theme/tokens';
import { useBottomInset } from '../../shared/hooks/safe-area';
import { JsonViewer } from '../../shared/components/JsonViewer';
import { layout } from '../../shared/styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

/** Preview budget for a text file — larger files are read up to this and flagged. */
const MAX_PREVIEW_BYTES = 512 * 1024;

export function FileDetail({
  browser,
  entry,
}: {
  browser: FileSystemBrowser;
  entry: DirectoryEntry;
}): React.ReactNode {
  const s = useStyles();
  const { strings } = useBesouroUI();
  const bottomInset = useBottomInset();
  const [meta, setMeta] = useState<FileMetadata | null>(null);
  const [text, setText] = useState<{ text: string; truncated: boolean } | null>(
    null
  );
  const [textStatus, setTextStatus] = useState<
    'idle' | 'loading' | 'ready' | 'too-large' | 'error'
  >('idle');
  const kind = classifyFile(entry.name);

  useEffect(() => {
    let cancelled = false;
    browser.stat(entry.path).then((resolved) => {
      if (!cancelled) {
        setMeta(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [browser, entry.path]);

  useEffect(() => {
    if (kind !== 'text') {
      return;
    }
    if (entry.sizeBytes != null && entry.sizeBytes > MAX_PREVIEW_BYTES) {
      setTextStatus('too-large');
      return;
    }
    let cancelled = false;
    setTextStatus('loading');
    browser.readText(entry.path, MAX_PREVIEW_BYTES).then((resolved) => {
      if (cancelled) {
        return;
      }
      if (resolved == null) {
        setTextStatus('error');
      } else {
        setText(resolved);
        setTextStatus('ready');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [browser, entry.path, entry.sizeBytes, kind]);

  const metadata = (
    <View style={styles.container2}>
      <KeyValueRow label={strings.path} value={entry.path} />
      <KeyValueRow
        label={strings.fileType}
        value={extensionOf(entry.name) || strings.noContent}
      />
      <KeyValueRow
        label={strings.size}
        value={formatBytes(entry.sizeBytes ?? meta?.sizeBytes)}
      />
      <KeyValueRow
        label={strings.modified}
        value={formatDateTime(entry.modifiedAt ?? meta?.modifiedAt)}
      />
    </View>
  );

  return (
    <View style={layout.fill}>
      <View style={s.row}>
        <BackButton />
        <MonoText style={layout.fill} size={fontSize.base} selectable>
          {entry.name}
        </MonoText>
        <ShareButton path={entry.path} />
      </View>

      {kind === 'text' && textStatus === 'ready' && text ? (
        <JsonViewer
          raw={text.text}
          truncated={text.truncated}
          ListHeaderComponent={metadata}
        />
      ) : (
        <ScrollView
          style={layout.fill}
          contentContainerStyle={{ paddingBottom: bottomInset }}
        >
          {metadata}
          {kind === 'image' ? (
            <Image
              source={{ uri: toFileUri(entry.path) }}
              resizeMode="contain"
              style={s.surface}
            />
          ) : (
            <Notice
              message={
                kind === 'text'
                  ? textStatus === 'too-large'
                    ? strings.fileTooLarge
                    : textStatus === 'loading'
                      ? ''
                      : strings.noContent
                  : strings.cannotPreview
              }
              loading={kind === 'text' && textStatus === 'loading'}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Header affordance that hands the current file to the OS share sheet via the
 * native module. Renders nothing when the native module isn't linked (tests /
 * web / Expo Go), matching how CopyButton hides itself without a clipboard.
 */
function ShareButton({ path }: { path: string }): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  if (!isShareAvailable()) {
    return null;
  }
  return (
    <Pressable
      onPress={() => shareFile(path)}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={strings.share}
    >
      <Icon name="share" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

function Notice({
  message,
  loading,
}: {
  message: string;
  loading: boolean;
}): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        <Text style={s.label}>{message}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 32,
    alignItems: 'center',
  },
  container2: {
    padding: space.lg,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.textMuted,
          fontSize: font(fontSize.base),
          textAlign: 'center',
        },
        surface: {
          height: 280,
          marginHorizontal: 12,
          marginTop: 4,
          marginBottom: 12,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: '#000',
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
      }),
    [theme, font]
  );
}
