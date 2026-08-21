/**
 * HTML body viewer for the Response tab — shown in place of the text viewer when
 * the response's content-type is a document, with a Preview/Raw toggle so the
 * markup stays one tap away.
 *
 * Preview renders the captured bytes in the library's own web view
 * (src/native/BesouroWebViewNativeComponent.ts) with a nil base url, so
 * relative subresources don't resolve: what you see came off the wire, and the
 * preview can't fire requests of its own that the inspector wouldn't record.
 *
 * That component is Fabric-only, so on the legacy renderer the toggle is not
 * offered at all and this degrades to exactly what the tab showed before.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { NetworkEvent } from '../../../core/types';
import BesouroWebView from '../../../native/BesouroWebViewNativeComponent';
import { EmptyState } from '../../../shared/components/EmptyState';
import { JsonViewer } from '../../../shared/components/JsonViewer';
import { SegmentedControl } from '../../../shared/components/SegmentedControl';
import { useBesouroUI } from '../../../shared/context';
import { isFabricRenderer } from '../../../shared/fabric';
import { layout } from '../../../shared/styles';
import { useBottomInset } from '../../../shared/hooks/safe-area';
import { useTextStyles } from '../../../shared/hooks/text-styles';
import { radius, space } from '../../../theme/tokens';

type Mode = 'preview' | 'raw';

const MODES: readonly Mode[] = ['preview', 'raw'];

export function HtmlResponse({
  event,
}: {
  event: NetworkEvent;
}): React.ReactNode {
  const s = useStyles();
  const text = useTextStyles();
  const { strings } = useBesouroUI();
  const [mode, setMode] = useState<Mode>('preview');

  const html = event.responseBody ?? '';
  const raw = <JsonViewer raw={html} truncated={event.responseBodyTruncated} />;

  if (!isFabricRenderer()) {
    return raw;
  }

  const labelFor = (option: Mode): string =>
    option === 'preview' ? strings.preview : strings.raw;

  return (
    <View style={layout.fill}>
      <View style={s.bar}>
        <SegmentedControl
          options={MODES}
          selected={mode}
          onSelect={setMode}
          labelFor={labelFor}
        />
        {/* Raw mode has the viewer's own banner; in preview the note has to sit
            here, because a document cut mid-tag renders as a torn page and
            otherwise looks like a bug in the preview. */}
        {mode === 'preview' && event.responseBodyTruncated ? (
          <Text style={text.bodyMuted} numberOfLines={1}>
            {strings.payloadTooLarge}
          </Text>
        ) : null}
      </View>
      {mode === 'raw' ? raw : <HtmlPreview html={html} />}
    </View>
  );
}

function HtmlPreview({ html }: { html: string }): React.ReactNode {
  const s = useStyles();
  const { strings } = useBesouroUI();
  const bottomInset = useBottomInset();
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <EmptyState message={strings.previewFailed} />;
  }

  return (
    <View style={[s.frame, { marginBottom: space.lg + bottomInset }]}>
      <BesouroWebView
        source={{ html }}
        onError={() => setFailed(true)}
        style={layout.fill}
      />
    </View>
  );
}

/** Theme-derived styles for this module, memoized per theme. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        bar: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingBottom: space.md,
        },
        // Mirrors the card the image tab frames its picture in, so a rendered
        // page sits in the tab the same way every other body does.
        frame: {
          flex: 1,
          marginHorizontal: space.lg,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.surface,
          overflow: 'hidden',
        },
      }),
    [theme]
  );
}
