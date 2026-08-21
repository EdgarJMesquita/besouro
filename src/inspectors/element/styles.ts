/** Layout constants shared by the element detail rows. */

import { type TextStyle } from 'react-native';

import { space } from '../../theme/tokens';

export const flexOne: TextStyle = { flex: 1 };

export const rowStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.sm,
} as const;

export const propRowStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.md,
  paddingVertical: space.sm,
} as const;
