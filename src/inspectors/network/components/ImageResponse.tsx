/**
 * Image preview for the Response tab — shown in place of the text viewer when the
 * response's content-type is an image RN can render.
 *
 * Renders the bytes captured at response time (a base64 data uri), so it shows
 * what actually arrived without re-fetching the URL: identical behaviour for GET
 * and POST, and it still works for a session restored from disk. When those bytes
 * are absent — too large, or a response the inspector couldn't decode — the tab
 * says so rather than showing an empty frame.
 */

import { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { NetworkEvent } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import { EmptyState } from '../../../shared/components/EmptyState';
import { Icon } from '../../../shared/components/Icon';
import { KeyValueRow } from '../../../shared/components/KeyValueRow';
import { useBottomInset } from '../../../shared/hooks/safe-area';
import { isShareAvailable, shareImage } from '../../../core/share';
import { radius, space } from '../../../theme/tokens';
import { layout } from '../../../shared/styles';
import { formatBytes } from '../../../shared/utils/bytes-format';
import { responseMediaType, MAX_IMAGE_BYTES } from '../content-type';

export function ImageResponse({
  event,
}: {
  event: NetworkEvent;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const bottomInset = useBottomInset();
  const [failed, setFailed] = useState(false);
  // Taken from the decoded image so tall and wide images both sit in the frame.
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  const uri = event.responseImageUri;

  if (!uri || failed) {
    // Size is recorded even when the bytes aren't, so an image skipped for being
    // over the cap says that, rather than blaming its format.
    const tooLarge = (event.responseSizeBytes ?? 0) > MAX_IMAGE_BYTES;
    return (
      <EmptyState
        message={tooLarge ? strings.imageTooLarge : strings.previewUnavailable}
      />
    );
  }

  return (
    <ScrollView
      style={layout.fill}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: space.lg + bottomInset,
      }}
    >
      <View style={s.frame}>
        <Image
          source={{ uri }}
          resizeMode="contain"
          style={[styles.image, { aspectRatio: aspectRatio ?? 1 }]}
          accessibilityIgnoresInvertColors
          onError={() => setFailed(true)}
          onLoad={({ nativeEvent }) => {
            const { width, height } = nativeEvent.source;
            if (width > 0 && height > 0) {
              setAspectRatio(width / height);
            }
          }}
        />
        {/* Floats over the frame's top-right, where the text viewer puts its
            copy chip — the image tab's equivalent affordance. */}
        {isShareAvailable() ? (
          <View style={s.chip}>
            <Pressable
              onPress={() => shareImage(uri)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={strings.share}
            >
              <Icon name="share" size={15} color={theme.textMuted} />
            </Pressable>
          </View>
        ) : null}
      </View>
      <KeyValueRow
        label={strings.contentType}
        value={responseMediaType(event)}
      />
      <KeyValueRow
        label={strings.size}
        value={formatBytes(event.responseSizeBytes)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%',
    // Keeps a portrait image from pushing the metadata off-screen.
    maxHeight: 360,
  },
});

/** Theme-derived styles for this module, memoized per theme. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        frame: {
          padding: space.md,
          marginBottom: space.lg,
          borderRadius: radius.md,
          backgroundColor: theme.surface,
        },
        // Mirrors the chip the text viewer floats over its card, so the image
        // tab's action sits where the copy action sits on every other response.
        chip: {
          position: 'absolute',
          top: space.md + space.sm,
          right: space.md + space.sm,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: radius.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.xs,
        },
      }),
    [theme]
  );
}
