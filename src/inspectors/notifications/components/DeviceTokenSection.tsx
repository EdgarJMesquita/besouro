/**
 * Device push tokens collected from the installed providers, shown above the
 * notification list so they can be copied for a test push.
 */

import { Text, View } from 'react-native';

import { useDeviceTokens } from '../store/device-tokens';
import type { DeviceToken } from '../store/device-tokens';
import { usePushProviders } from '../store/push-providers';

import { useBesouroUI } from '../../../shared/context';

import { CopyButton } from '../../../shared/components/CopyButton';

import { MonoText } from '../../../shared/components/MonoText';
import { Pill } from '../../../shared/components/Pill';
import { space, radius, fontSize, fontWeight } from '../../../theme/tokens';
import { layout } from '../../../shared/styles';
import { useTextStyles } from '../../../shared/hooks/text-styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function DeviceTokenSection(): React.ReactNode {
  const s = useStyles();
  const text = useTextStyles();
  const { theme, strings } = useBesouroUI();
  const tokens = useDeviceTokens();
  const providers = usePushProviders();

  // Nothing to show when no push source is available (e.g. Android without
  // firebase/expo installed).
  if (providers.length === 0) return null;

  return (
    <View style={s.surface}>
      {tokens.length === 0 ? (
        <View style={styles.block2}>
          {/* No token resolved yet — advertise the available providers so the
              drawer still communicates which push sources are in play. */}
          <View style={layout.rowGapSm}>
            {providers.map((provider) => (
              <Pill key={provider} label={provider} color={theme.textMuted} />
            ))}
          </View>
          <Text style={text.bodyMuted}>{strings.noDeviceToken}</Text>
        </View>
      ) : (
        tokens.map((token) => (
          <TokenCard key={`${token.provider}:${token.kind}`} token={token} />
        ))
      )}
    </View>
  );
}

/**
 * A single device token, rendered as a labeled block (mirroring the JsonViewer):
 * the `provider/kind` label sits top-left *outside* a bordered card, and the full
 * token wraps in monospace inside it with a copy button. Errors replace the value
 * in warning color and drop the copy button (there's nothing to copy).
 */
function TokenCard({ token }: { token: DeviceToken }): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  const isError = Boolean(token.error);

  return (
    <View style={styles.block}>
      <Text style={s.label2}>{tokenLabel(token).toUpperCase()}</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.md,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: isError ? theme.warning : theme.border,
          backgroundColor: theme.surfaceRaised,
        }}
      >
        {isError ? (
          <Text style={s.label} selectable>
            {token.error}
          </Text>
        ) : (
          <>
            <MonoText
              color={theme.text}
              size={fontSize.caption}
              style={layout.fill}
              selectable
            >
              {token.token}
            </MonoText>
            <CopyButton value={token.token} />
          </>
        )}
      </View>
    </View>
  );
}

/** Card label for a token: `provider/kind`, collapsed to a single word when the
 *  two are identical (e.g. native APNs reports both as "apns"). */
function tokenLabel(token: DeviceToken): string {
  return token.provider === token.kind
    ? token.provider
    : `${token.provider}/${token.kind}`;
}

const styles = StyleSheet.create({
  block: {
    gap: space.xs,
  },
  block2: {
    gap: space.sm,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          flex: 1,
          color: theme.warning,
          fontSize: font(fontSize.caption),
        },
        label2: {
          color: theme.textMuted,
          fontSize: font(fontSize.micro),
          fontWeight: fontWeight.bold,
          letterSpacing: 0.5,
        },
        surface: {
          padding: space.lg,
          gap: space.md,
          backgroundColor: theme.surface,
        },
      }),
    [theme, font]
  );
}
