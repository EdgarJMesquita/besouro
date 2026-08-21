/**
 * Origin filter — narrows the list to locally scheduled or server-pushed
 * notifications.
 */

import { Pressable, ScrollView, Text, View } from 'react-native';

import { useBesouroUI } from '../../../shared/context';

import { space, fontSize, fontWeight } from '../../../theme/tokens';

export type OriginFilter = 'all' | 'local' | 'remote';

const ORIGIN_FILTERS: readonly OriginFilter[] = ['all', 'local', 'remote'];

export function OriginFilterBar({
  value,
  onChange,
}: {
  value: OriginFilter;
  onChange: (filter: OriginFilter) => void;
}): React.ReactNode {
  const { theme, font } = useBesouroUI();
  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space.xs }}
      >
        {ORIGIN_FILTERS.map((f) => {
          const active = f === value;
          return (
            <Pressable
              key={f}
              onPress={() => onChange(f)}
              style={{
                paddingVertical: space.lg,
                paddingHorizontal: space.gutter,
                borderBottomWidth: 2,
                borderBottomColor: active ? theme.accent : 'transparent',
              }}
            >
              <Text
                style={{
                  color: active ? theme.accent : theme.textMuted,
                  fontSize: font(fontSize.base),
                  fontWeight: active ? fontWeight.bold : fontWeight.medium,
                  textTransform: 'capitalize',
                }}
              >
                {f}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
