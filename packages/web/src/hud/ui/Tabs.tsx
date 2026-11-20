import type { ComponentProps } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import { SEGMENT_GROUP, SEGMENT_ITEM } from './segmentStyles';

export const Tabs = RadixTabs.Root;

/**
 * `segment` is a macOS segmented control; `sidebar` is a System Settings source list (pair it
 * with `orientation="vertical"` on `Tabs`, so arrow keys move up and down).
 */
type Variant = 'segment' | 'sidebar';

const LIST: Record<Variant, string> = {
  segment: `flex gap-1 pointer-coarse:gap-2 ${SEGMENT_GROUP}`,
  sidebar: 'flex flex-col gap-0.5',
};

const ITEM: Record<Variant, string> = {
  segment: SEGMENT_ITEM,
  sidebar:
    'w-full rounded-lg px-3 py-1.5 text-left font-hud-body text-[13px] font-medium text-hud-text transition-colors hover:bg-hud-hover ' +
    'data-[state=active]:bg-hud-accent data-[state=active]:text-hud-on-accent focus-visible:outline-2 focus-visible:outline-hud-accent pointer-coarse:min-h-12',
};

export function TabList({ className = '', variant = 'segment', ...props }: ComponentProps<typeof RadixTabs.List> & { variant?: Variant }) {
  return <RadixTabs.List className={`${LIST[variant]} ${className}`} {...props} />;
}

export function Tab({ className = '', variant = 'segment', ...props }: ComponentProps<typeof RadixTabs.Trigger> & { variant?: Variant }) {
  return <RadixTabs.Trigger className={`${ITEM[variant]} ${className}`} {...props} />;
}

export const TabContent = RadixTabs.Content;
