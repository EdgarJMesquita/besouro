/**
 * Horizontal tab strip for a detail screen — an underlined, scrollable row of
 * section names.
 *
 * Renders bare (no surrounding background) so a caller that needs one can wrap it;
 * labels come entirely from `labelFor`, so a caller can pass localized strings or
 * format the raw tab name itself.
 */

import { Pressable, ScrollView, Text } from 'react-native';
import { useBesouroUI } from '../context';
import { space, fontSize, fontWeight } from '../../theme/tokens';

export function DetailTabs<Tab extends string>({
  tabs,
  selected,
  onSelect,
  labelFor,
  fill = false,
}: {
  tabs: readonly Tab[];
  selected: Tab;
  onSelect: (tab: Tab) => void;
  labelFor: (tab: Tab) => string;
  /**
   * Divide the full width between the tabs instead of packing them at the left.
   *
   * Opt-in, because the default suits the many-sectioned detail views this was
   * built for (Network's five) where the strip is meant to scroll. It is for a
   * small fixed set — two or three — where left-hugging tabs read as an unfinished
   * row rather than a choice. Long labels would be squeezed rather than scrolled,
   * which is the trade being made.
   */
  fill?: boolean;
}): React.ReactNode {
  const { theme, font } = useBesouroUI();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Nothing can overflow once the tabs divide the viewport, so the scroll is
      // turned off rather than left to bounce against its own content.
      scrollEnabled={!fill}
      contentContainerStyle={
        fill ? { flexGrow: 1 } : { paddingHorizontal: space.xs }
      }
    >
      {tabs.map((tab) => {
        const active = tab === selected;
        return (
          <Pressable
            key={tab}
            onPress={() => onSelect(tab)}
            style={{
              paddingVertical: space.xl,
              paddingHorizontal: space.gutter,
              borderBottomWidth: 2,
              borderBottomColor: active ? theme.accent : 'transparent',
              ...(fill ? { flex: 1, alignItems: 'center' as const } : null),
            }}
          >
            <Text
              style={{
                color: active ? theme.accent : theme.textMuted,
                fontSize: font(fontSize.base),
                fontWeight: active ? fontWeight.bold : fontWeight.medium,
              }}
            >
              {labelFor(tab)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
