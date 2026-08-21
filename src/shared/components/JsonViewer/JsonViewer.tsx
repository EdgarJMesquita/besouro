/**
 * Virtualized JSON / payload viewer (§7.1). Flattens parsed JSON to lines and
 * renders them through a `FlatList` with a fixed row height, so only visible rows
 * mount and multi-MB payloads never freeze the JS thread. Falls back to a
 * virtualized text viewer when the body isn't JSON.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  Text,
  View,
  type ListRenderItem,
} from 'react-native';
import { useBesouroUI } from '../../context';
import { copyToClipboard, isClipboardAvailable } from '../../../core/clipboard';
import { CopyButton } from '../CopyButton';
import {
  flattenJson,
  computeVisibleLines,
  flashedLineIds,
  type JsonLine,
} from './flatten';
import { space, radius, fontSize, fontWeight } from '../../../theme/tokens';
import { useBottomInset } from '../../hooks/safe-area';
import { withAlpha } from '../../utils/with-alpha';
import { layout } from '../../styles';
import { StyleSheet } from 'react-native';

const ROW_HEIGHT = 20;
const INDENT_WIDTH = 12;
/** How long a changed row stays tinted before fading out, in ms. */
const FLASH_DURATION = 900;

/**
 * Which rows changed, and when — the input to the change flash.
 *
 * Keyed by {@link JsonLine.path}, never by `id`: ids are positional (`line-N`) and
 * are reassigned every time the document is re-flattened, which is exactly what
 * happens when the value changes. Paths survive it.
 *
 * `nonce` must change on every publish even when `paths` does not, or a value
 * changing twice in a row would flash only once.
 */
export interface JsonFlash {
  paths: ReadonlySet<string>;
  nonce: number;
}

interface JsonViewerProps {
  /** Raw captured body/payload text. */
  raw: string;
  /** Whether capture truncated this body (shows a banner). */
  truncated?: boolean;
  /**
   * Optional content rendered above the rows, scrolling with them inside the
   * viewer's own `FlatList`. Use this to render surrounding metadata instead of
   * wrapping the viewer in a `ScrollView` (which would nest VirtualizedLists).
   */
  ListHeaderComponent?: React.ReactElement | null;
  /**
   * Whether to pad the card's bottom by the safe-area inset so its last rows
   * clear the home indicator / nav bar. Defaults to `true` — set `false` when
   * the viewer isn't the bottom-most element (e.g. the top pane of a split
   * detail view), so it doesn't leave a gap above what follows it.
   */
  insetBottom?: boolean;
  /**
   * Briefly tint the rows whose value just changed (§7.1). Optional and unset by
   * every detail view — only the live state panes, where the document is being
   * re-rendered under the reader, have anything to point at.
   */
  flash?: JsonFlash;
}

export function JsonViewer({
  raw,
  truncated,
  ListHeaderComponent,
  insetBottom = true,
  flash,
}: JsonViewerProps): React.ReactNode {
  const s = useStyles();
  const { strings } = useBesouroUI();
  const safeBottom = useBottomInset();
  const bottomInset = insetBottom ? safeBottom : 0;

  const parsed = useMemo(() => tryParseJson(raw), [raw]);

  const body = parsed.ok ? (
    <JsonTree root={parsed.value} bottomInset={bottomInset} flash={flash} />
  ) : (
    <TextViewer text={raw} bottomInset={bottomInset} />
  );

  // The header (metadata, section labels) renders untinted above the rows; only
  // the serialized value sits inside the tinted, rounded container. A copy chip
  // floats over the card's top-right so the whole payload can be copied without
  // long-pressing a row, and stays put while the rows scroll under it.
  return (
    <View style={layout.fill}>
      {truncated ? <TruncationBanner label={strings.payloadTooLarge} /> : null}
      {ListHeaderComponent}
      <View style={layout.fill}>
        {body}
        {isClipboardAvailable() ? (
          <View style={s.surface2}>
            <CopyButton value={raw} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The tinted, rounded card that wraps the serialized rows — a `surfaceRaised`
 * container inset from the drawer so the payload reads as a distinct block.
 */
function useViewerCardStyle(bottomInset: number): object {
  const { theme } = useBesouroUI();
  // When the card fills to the bottom of the detail view, `bottomInset` carries
  // the safe-area inset so its bottom edge (and last rows) clear the home
  // indicator / nav bar.
  return {
    flex: 1,
    marginHorizontal: space.xl,
    marginTop: space.xs,
    marginBottom: space.xl + bottomInset,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceRaised,
    overflow: 'hidden' as const,
  };
}

function JsonTree({
  root,
  bottomInset,
  flash,
}: {
  root: unknown;
  bottomInset: number;
  flash?: JsonFlash;
}): React.ReactNode {
  const cardStyle = useViewerCardStyle(bottomInset);
  const allLines = useMemo(() => flattenJson(root), [root]);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const visibleLines = useMemo(
    () => computeVisibleLines(allLines, collapsedIds),
    [allLines, collapsedIds]
  );

  // A changed container tints its whole subtree, not just the line naming it —
  // see `flashedLineIds`.
  const flashedIds = useMemo(
    () =>
      flash && flash.paths.size > 0
        ? flashedLineIds(allLines, flash.paths)
        : null,
    [allLines, flash]
  );

  const toggle = useCallback((line: JsonLine): void => {
    if (!line.collapsible) {
      return;
    }
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(line.id)) {
        next.delete(line.id);
      } else {
        next.add(line.id);
      }
      return next;
    });
  }, []);

  const handleCopy = useCallback(
    (line: JsonLine): void => {
      copyToClipboard(serializeLine(root, line));
    },
    [root]
  );

  const keyExtractor = useCallback((line: JsonLine) => line.id, []);
  const renderItem = useCallback<ListRenderItem<JsonLine>>(
    ({ item }) => (
      <JsonRow
        line={item}
        collapsed={collapsedIds.has(item.id)}
        // Resolved to a number here rather than passing `flash` down, so the prop
        // stays primitive and the row's `memo` keeps skipping untouched rows.
        flashKey={flashedIds?.has(item.id) && flash ? flash.nonce : null}
        onToggle={toggle}
        onCopy={handleCopy}
      />
    ),
    [collapsedIds, toggle, handleCopy, flash, flashedIds]
  );

  return (
    <FlatList
      data={visibleLines}
      keyExtractor={keyExtractor}
      style={cardStyle}
      contentContainerStyle={{ paddingVertical: space.sm }}
      initialNumToRender={40}
      windowSize={11}
      // NOT removeClippedSubviews: rows are variable-height (a long string value
      // wraps into a tall row) and there's no getItemLayout. Clipping detaches
      // that tall cell's native view, losing its measured height, so the list
      // under-reports its content size and the last rows can't be scrolled into
      // view (the trailing rows get cropped). Keeping cells attached preserves
      // correct measurement so the end of the list is always reachable.
      removeClippedSubviews={false}
      renderItem={renderItem}
    />
  );
}

const JsonRow = memo(function JsonRow({
  line,
  collapsed,
  flashKey,
  onToggle,
  onCopy,
}: {
  line: JsonLine;
  collapsed: boolean;
  /** Non-null when this row just changed; its value changes on every change. */
  flashKey: number | null;
  onToggle: (line: JsonLine) => void;
  onCopy: (line: JsonLine) => void;
}): React.ReactNode {
  const s = useStyles();
  const { theme } = useBesouroUI();
  const punctuation = theme.syntax.punctuation;
  const handlePress = useCallback(() => onToggle(line), [onToggle, line]);
  const handleLongPress = useCallback(() => onCopy(line), [onCopy, line]);

  // Opacity of a tinted overlay rather than the row's own `backgroundColor`:
  // color is not native-driver-able, and a JS-driven animation per changed row is
  // exactly the work the drawer should not be doing while the app dispatches.
  const flashOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (flashKey == null) {
      return;
    }
    flashOpacity.setValue(1);
    const animation = Animated.timing(flashOpacity, {
      toValue: 0,
      duration: FLASH_DURATION,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [flashKey, flashOpacity]);

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={isClipboardAvailable() ? handleLongPress : undefined}
      style={{
        minHeight: ROW_HEIGHT,
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 2,
        paddingRight: 8,
        paddingLeft: 8 + line.depth * INDENT_WIDTH,
      }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.flash,
          {
            backgroundColor: withAlpha(theme.accent, 0.35),
            opacity: flashOpacity,
          },
        ]}
      />
      {line.collapsible ? (
        <Text style={s.label4}>{collapsed ? '▸' : '▾'}</Text>
      ) : (
        <View style={styles.box} />
      )}
      <Text style={s.label3} selectable>
        {line.keyText != null ? (
          <Text style={s.label2}>
            {`"${line.keyText}"`}
            <Text style={{ color: punctuation }}>: </Text>
          </Text>
        ) : null}
        <RowValue line={line} collapsed={collapsed} />
        {line.hasTrailingComma ? (
          <Text style={{ color: punctuation }}>,</Text>
        ) : null}
      </Text>
    </Pressable>
  );
});

function RowValue({
  line,
  collapsed,
}: {
  line: JsonLine;
  collapsed: boolean;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const punctuation = theme.syntax.punctuation;

  if (line.kind === 'close') {
    return <Text style={{ color: punctuation }}>{line.bracket}</Text>;
  }
  if (line.kind === 'key-open' || line.kind === 'open') {
    if (collapsed) {
      const close = line.bracket === '[' ? ']' : '}';
      return (
        <Text style={{ color: punctuation }}>
          {`${line.bracket}… ${line.childCount ?? 0} ${close}`}
        </Text>
      );
    }
    return <Text style={{ color: punctuation }}>{line.bracket}</Text>;
  }
  return (
    <Text style={{ color: colorForType(theme, line.valueType) }}>
      {line.valueText}
    </Text>
  );
}

function TextViewer({
  text,
  bottomInset,
}: {
  text: string;
  bottomInset: number;
}): React.ReactNode {
  const cardStyle = useViewerCardStyle(bottomInset);
  const lines = useMemo(
    () => text.split('\n').map((content, index) => ({ id: index, content })),
    [text]
  );
  const keyExtractor = useCallback(
    (item: { id: number }) => String(item.id),
    []
  );
  const renderItem = useCallback<
    ListRenderItem<{ id: number; content: string }>
  >(({ item }) => <RawLine content={item.content} />, []);

  return (
    <FlatList
      data={lines}
      keyExtractor={keyExtractor}
      style={cardStyle}
      contentContainerStyle={{ paddingVertical: space.sm }}
      initialNumToRender={40}
      windowSize={11}
      // See JsonTree: a long line wraps into a tall cell; clipping loses its
      // measured height and crops the tail. Keep cells attached.
      removeClippedSubviews={false}
      renderItem={renderItem}
    />
  );
}

function TruncationBanner({ label }: { label: string }): React.ReactNode {
  const s = useStyles();

  return (
    <View style={s.surface}>
      <Text style={s.label}>{label}</Text>
    </View>
  );
}

function colorForType(
  theme: ReturnType<typeof useBesouroUI>['theme'],
  valueType: JsonLine['valueType']
): string {
  switch (valueType) {
    case 'string':
      return theme.syntax.string;
    case 'number':
      return theme.syntax.number;
    case 'boolean':
      return theme.syntax.boolean;
    case 'null':
      return theme.syntax.null;
    default:
      return theme.text;
  }
}

type ParseResult = { ok: true; value: unknown } | { ok: false };

function tryParseJson(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

/** Re-serialize the value at a line's path for copy-subtree / copy-value. */
function serializeLine(root: unknown, line: JsonLine): string {
  const value = resolvePath(root, line.path);
  if (value === undefined) {
    return line.valueText ?? '';
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return line.valueText ?? '';
    }
  }
  return typeof value === 'string' ? value : String(value);
}

function resolvePath(root: unknown, path: string): unknown {
  if (!path) {
    return root;
  }
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0);
  let current: unknown = root;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** One line of the raw-text view; memoized so the list can skip untouched rows. */
const RawLine = memo(function RawLine({
  content,
}: {
  content: string;
}): React.ReactNode {
  const s = useStyles();
  return (
    <Text style={s.rawLine} selectable>
      {content}
    </Text>
  );
});

const styles = StyleSheet.create({
  box: {
    width: 12,
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        rawLine: {
          minHeight: ROW_HEIGHT,
          paddingHorizontal: 8,
          paddingVertical: 2,
          fontFamily: 'Courier',
          fontSize: font(fontSize.body),
          color: theme.text,
        },
        label: {
          color: theme.warning,
          fontSize: fontSize.caption,
          fontWeight: fontWeight.semibold,
        },
        surface: {
          paddingVertical: space.sm,
          paddingHorizontal: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.warning,
        },
        label2: {
          color: theme.syntax.key,
        },
        label3: {
          flex: 1,
          fontFamily: 'Courier',
          fontSize: font(fontSize.body),
        },
        label4: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          width: 12,
        },
        surface2: {
          position: 'absolute',
          top: space.xs + space.sm,
          right: space.xl + space.sm,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: radius.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.xs,
        },
      }),
    [theme, font]
  );
}
