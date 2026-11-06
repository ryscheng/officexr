import type { ComponentProps } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import { SEGMENT_GROUP, SEGMENT_ITEM } from './segmentStyles';

export const Tabs = RadixTabs.Root;

export function TabList({ className = '', ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={`flex gap-1 ${SEGMENT_GROUP} ${className}`} {...props} />;
}

export function Tab({ className = '', ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={`${SEGMENT_ITEM} ${className}`}
      {...props}
    />
  );
}

export const TabContent = RadixTabs.Content;
