import type { ComponentProps } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';

export const Tabs = RadixTabs.Root;

export function TabList({ className = '', ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={`flex gap-1 rounded-hud-control bg-hud-inset p-1 ${className}`} {...props} />;
}

export function Tab({ className = '', ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={`rounded-hud-control px-3 py-1.5 font-hud-body text-sm font-bold text-hud-text-2 data-[state=active]:bg-hud-accent data-[state=active]:text-hud-on-accent pointer-coarse:min-h-11 ${className}`}
      {...props}
    />
  );
}

export const TabContent = RadixTabs.Content;
