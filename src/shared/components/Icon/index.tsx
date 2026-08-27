/**
 * Icons composed from React Native primitives — no icon font, SVG, or icon
 * library. Each icon is a few `View` shapes (borders / `borderRadius` /
 * `transform`) sized and colored from props. Set: Copy, Close, Search, Gear,
 * Bug, chevrons/arrows, Folder, File, List, Grid, Check, Refresh, resize grip,
 * and align (left/center/right).
 */

import {
  AlignLinesIcon,
  ArrowLeftIcon,
  BugIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  FileIcon,
  FolderIcon,
  ExpandIcon,
  GearIcon,
  GridIcon,
  GridOutlineIcon,
  HistoryIcon,
  LayersIcon,
  ListIcon,
  MinimizeIcon,
  RefreshIcon,
  ResizeGripIcon,
  SearchIcon,
  ShareIcon,
} from './shapes';

export type IconName =
  | 'copy'
  | 'share'
  | 'check'
  | 'close'
  | 'search'
  | 'gear'
  | 'history'
  | 'bug'
  | 'minimize'
  | 'expand'
  | 'resize-grip'
  | 'refresh'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-left'
  | 'folder'
  | 'file'
  | 'list'
  | 'grid'
  | 'grid-outline'
  | 'layers'
  | 'align-left'
  | 'align-center'
  | 'align-right';

interface IconProps {
  name: IconName;
  size?: number;
  color: string;
  /**
   * Color painted behind the icon, for the two shapes that need to occlude
   * something: the gear's center hole, and the near sheet of `layers`, which
   * hides the ones behind it. Both must match the surface the icon sits on.
   * Defaults to `color` when omitted.
   */
  background?: string;
}

export function Icon({
  name,
  size = 18,
  color,
  background,
}: IconProps): React.ReactNode {
  switch (name) {
    case 'copy':
      return <CopyIcon size={size} color={color} />;
    case 'share':
      return <ShareIcon size={size} color={color} />;
    case 'check':
      return <CheckIcon size={size} color={color} />;
    case 'close':
      return <CloseIcon size={size} color={color} />;
    case 'search':
      return <SearchIcon size={size} color={color} />;
    case 'gear':
      return <GearIcon size={size} color={color} background={background} />;
    case 'history':
      return <HistoryIcon size={size} color={color} />;
    case 'bug':
      return <BugIcon size={size} color={color} />;
    case 'minimize':
      return <MinimizeIcon size={size} color={color} />;
    case 'expand':
      return <ExpandIcon size={size} color={color} />;
    case 'resize-grip':
      return <ResizeGripIcon size={size} color={color} />;
    case 'refresh':
      return <RefreshIcon size={size} color={color} />;
    case 'chevron-left':
      return <ChevronLeftIcon size={size} color={color} />;
    case 'chevron-right':
      return <ChevronRightIcon size={size} color={color} />;
    case 'arrow-left':
      return <ArrowLeftIcon size={size} color={color} />;
    case 'folder':
      return <FolderIcon size={size} color={color} />;
    case 'file':
      return <FileIcon size={size} color={color} />;
    case 'list':
      return <ListIcon size={size} color={color} />;
    case 'grid':
      return <GridIcon size={size} color={color} />;
    case 'grid-outline':
      return <GridOutlineIcon size={size} color={color} />;
    case 'layers':
      return (
        <LayersIcon
          size={size}
          color={color}
          background={background ?? color}
        />
      );
    case 'align-left':
      return <AlignLinesIcon size={size} color={color} align="flex-start" />;
    case 'align-center':
      return <AlignLinesIcon size={size} color={color} align="center" />;
    case 'align-right':
      return <AlignLinesIcon size={size} color={color} align="flex-end" />;
  }
}
