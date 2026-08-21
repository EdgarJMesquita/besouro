/**
 * Copy affordance used throughout the drawer. Routes through the clipboard util
 * (§12) and hides itself entirely when no clipboard peer is configured. Briefly
 * shows a success check icon after a successful copy.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { copyToClipboard, isClipboardAvailable } from '../../core/clipboard';
import { hapticTap } from '../../core/haptics';
import { useBesouroUI } from '../context';
import { Icon } from './Icon';
import { StyleSheet } from 'react-native';

interface CopyButtonProps {
  /** Text to copy, or a getter evaluated on press (for large/lazy values). */
  value: string | (() => string);
  size?: number;
  /** Optional inline label shown next to the icon. */
  label?: string;
  /**
   * Render as a plain accent-colored text link (no copy icon). Requires `label`.
   * Used for affordances like "Copy as cURL" that read as an action, not a glyph.
   */
  textOnly?: boolean;
}

export function CopyButton({
  value,
  size = 15,
  label,
  textOnly = false,
}: CopyButtonProps): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearResetTimer(timeoutRef.current);
      }
    };
  }, []);

  if (!isClipboardAvailable()) {
    return null;
  }

  const onPress = (): void => {
    const text = typeof value === 'function' ? value() : value;
    if (!copyToClipboard(text)) {
      return;
    }
    // Only on a copy that landed. The check icon is the visible half of the
    // acknowledgement and a failed copy shows none of it — a tap for a press
    // that put nothing on the clipboard would be a lie told under the finger.
    hapticTap();
    setCopied(true);
    if (timeoutRef.current !== null) {
      clearResetTimer(timeoutRef.current);
    }
    timeoutRef.current = scheduleReset(() => setCopied(false));
  };

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={strings.copy}
      style={styles.row3}
    >
      {copied ? (
        <View style={styles.row2}>
          <Icon name="check" size={size} color={theme.success} />
          {label ? (
            <Text style={{ color: theme.success, fontSize: size * 0.85 }}>
              {label}
            </Text>
          ) : null}
        </View>
      ) : textOnly ? (
        <Text
          style={{
            color: theme.accent,
            fontSize: size * 0.85,
            fontWeight: '600',
          }}
        >
          {label}
        </Text>
      ) : (
        <View style={styles.row}>
          <Icon name="copy" size={size} color={theme.textMuted} />
          {label ? (
            <Text style={{ color: theme.textMuted, fontSize: size * 0.85 }}>
              {label}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const timers = globalThis as unknown as {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(handle: number): void;
};

function scheduleReset(reset: () => void): number {
  return timers.setTimeout(reset, 1200);
}

function clearResetTimer(handle: number): void {
  timers.clearTimeout(handle);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  row2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  row3: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
