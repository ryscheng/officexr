import { Building2 } from 'lucide-react';
import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { Panel } from './ui/Panel';

const selectPresentCount = (s: OfficeState) => Object.keys(s.players).length;

export function OfficeNamePlate({ store, name }: { store: Store; name: string }) {
  const present = useStoreSelector(store, selectPresentCount);
  return (
    <Panel className="pointer-events-auto flex max-w-72 items-center gap-2.5 py-1.5 pr-4 pl-1.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-hud-control bg-hud-accent text-hud-on-accent">
        <Building2 aria-hidden className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate font-hud-title text-sm font-normal tracking-widest">{name}</div>
        <div className="text-xs text-hud-text-2">{present} here</div>
      </div>
    </Panel>
  );
}
