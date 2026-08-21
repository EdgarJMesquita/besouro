/**
 * Network detail screen — request/response bodies and headers for one request,
 * split across four sections.
 */

import { useState } from 'react';

import { ScrollView, Text, View } from 'react-native';

import type { NetworkEvent } from '../../core/types';
import { useBesouroUI } from '../../shared/context';

import { useEventWithDetail } from '../../shared/hooks/event-detail';
import { DetailTabs } from '../../shared/components/DetailTabs';
import { DetailLoading } from '../../shared/components/DetailLoading';
import { CopyButton } from '../../shared/components/CopyButton';
import { BackButton } from '../../shared/components/BackButton';
import { EmptyState } from '../../shared/components/EmptyState';
import { KeyValueRow } from '../../shared/components/KeyValueRow';

import { MonoText } from '../../shared/components/MonoText';
import { Pill } from '../../shared/components/Pill';
import { SectionHeader } from '../../shared/components/SectionHeader';
import { space, fontSize } from '../../theme/tokens';
import { useBottomInset } from '../../shared/hooks/safe-area';

import { JsonViewer } from '../../shared/components/JsonViewer';

import { formatDuration } from '../../shared/utils/duration-format';
import { buildCurl } from './format';
import { isHtmlResponse, isImageResponse } from './content-type';
import { HtmlResponse } from './components/HtmlResponse';
import { ImageResponse } from './components/ImageResponse';
import { StatusPill } from './components/StatusPill';
import { layout } from '../../shared/styles';
import { useTextStyles } from '../../shared/hooks/text-styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

type DetailTab = 'response' | 'responseHeaders' | 'request' | 'requestHeaders';

/**
 * How much of the request has been written, as a number that moves each time it
 * grows — the cue {@link useEventWithDetail} re-reads the row on.
 *
 * A network row is not written once. It is inserted `pending` when the request
 * leaves, then patched as it completes: first the outcome (status, headers,
 * duration, phase), then the body and its size. A detail opened mid-flight would
 * otherwise keep the pending copy it read on open — status, duration and the
 * whole Response tab frozen — while the list row behind it updated, and only
 * closing and reopening would show the response.
 *
 * Both terms read summary columns, so the live list row carries them here; each
 * one announces heavy columns (headers, bodies) that only a re-read can reach.
 *
 * An image preview is the one thing this cannot see: `responseImageUri` is heavy,
 * and it is patched after the size it comes with. Same flush in the common case,
 * so the re-read this triggers picks it up — but a blob slow enough to miss that
 * flush lands a patch no summary column reflects, and the preview waits for a
 * reopen.
 */
function patchesLanded(summary: NetworkEvent): number {
  return (
    (summary.phase === 'pending' ? 0 : 1) +
    (summary.responseSizeBytes === undefined ? 0 : 2)
  );
}

/**
 * `summary` is the list row, which carries identity and status but no bodies or
 * headers — those live in the database until asked for. The toolbar renders from
 * it immediately; the body/header sections fill in when the full row arrives.
 *
 * It is also the *live* row — `NetworkTab` picks it out of the paged query, which
 * re-runs as writes land — which is what makes {@link patchesLanded} able to
 * report a request finishing.
 */
export function NetworkDetail({
  summary,
}: {
  summary: NetworkEvent;
}): React.ReactNode {
  const s = useStyles();
  const text = useTextStyles();
  const { theme, strings } = useBesouroUI();
  const [tab, setTab] = useState<DetailTab>('response');
  const { event, loadingDetail } = useEventWithDetail<NetworkEvent>(
    'network',
    summary,
    { revision: patchesLanded(summary) }
  );

  const labelFor = (detailTab: DetailTab): string => {
    switch (detailTab) {
      case 'response':
        return strings.response;
      case 'responseHeaders':
        return strings.responseHeaders;
      case 'request':
        return strings.request;
      case 'requestHeaders':
        return strings.requestHeaders;
    }
  };

  return (
    <View style={layout.fill}>
      {/* Toolbar: back + method + status + duration, separated by a line. */}
      <View style={s.row}>
        <BackButton />
        <Pill label={event.method} color={theme.accent} />
        <StatusPill event={event} />
        <Text style={text.bodyMuted}>
          {`${strings.duration}: ${formatDuration(event.durationMs)}`}
        </Text>
        <View style={layout.fill} />
        {/* <DetailTimestamp timestamp={event.timestamp} /> */}
      </View>
      {/* URL + Copy as cURL — content below the toolbar, no separator. */}
      <View style={s.surface3}>
        <View style={styles.row}>
          <MonoText style={s.label} size={fontSize.body} selectable>
            {event.url}
          </MonoText>
          <CopyButton value={event.url} />
        </View>
        <View style={layout.row}>
          <CopyButton
            value={() => buildCurl(event)}
            label={strings.copyAsCurl}
            textOnly
          />
        </View>
      </View>

      <View style={s.surface2}>
        <DetailTabs
          tabs={DETAIL_TABS}
          selected={tab}
          onSelect={setTab}
          labelFor={labelFor}
        />
      </View>

      {/* Small gap so the body content doesn't butt up against the tab bar. */}
      <View style={s.surface}>
        <DetailBody event={event} tab={tab} loading={loadingDetail} />
      </View>
    </View>
  );
}

function DetailBody({
  event,
  tab,
  loading,
}: {
  event: NetworkEvent;
  tab: DetailTab;
  /** The heavy columns are still being read; don't claim "no body" yet. */
  loading: boolean;
}): React.ReactNode {
  const { strings } = useBesouroUI();
  if (loading) {
    return <DetailLoading />;
  }
  switch (tab) {
    case 'response':
      // An image body never reaches the text viewer — it is captured as bytes,
      // not text, so the tab shows the picture instead (§6.1).
      if (isImageResponse(event)) {
        return <ImageResponse event={event} />;
      }
      // An HTML body reads as a page, not as a tree, so it gets the web view
      // with a Raw toggle rather than the JSON viewer alone.
      if (isHtmlResponse(event) && event.responseBody) {
        return <HtmlResponse event={event} />;
      }
      return event.responseBody ? (
        <JsonViewer
          raw={event.responseBody}
          truncated={event.responseBodyTruncated}
        />
      ) : (
        <EmptyState message={strings.noBody} />
      );
    case 'request':
      return event.requestBody ? (
        <JsonViewer
          raw={event.requestBody}
          truncated={event.requestBodyTruncated}
        />
      ) : (
        <EmptyState message={strings.noBody} />
      );
    case 'responseHeaders':
      return <HeaderList headers={event.responseHeaders} />;
    case 'requestHeaders':
      return <HeaderList headers={event.requestHeaders} />;
  }
}

const DETAIL_TABS: readonly DetailTab[] = [
  'response',
  'responseHeaders',
  'request',
  'requestHeaders',
];

function HeaderList({
  headers,
}: {
  headers: Record<string, string> | undefined;
}): React.ReactNode {
  const { strings } = useBesouroUI();
  const bottomInset = useBottomInset();
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) {
    return <EmptyState message={strings.noHeaders} />;
  }
  return (
    <ScrollView
      style={layout.fill}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: space.lg + bottomInset,
      }}
    >
      <SectionHeader title={`${entries.length}`} />
      {entries.map(([name, value]) => (
        <KeyValueRow key={name} label={name} value={value} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        surface: {
          flex: 1,
          paddingTop: space.md,
          backgroundColor: theme.background,
        },
        surface2: {
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
        label: {
          flex: 1,
          color: theme.text,
        },
        surface3: {
          padding: space.lg,
          gap: space.xl,
          backgroundColor: theme.surface,
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
    [theme]
  );
}
