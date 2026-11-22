import { useEffect, useSyncExternalStore } from 'react';
import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { focusWorld, usePlayControls, useStoreSelector } from '@officexr/world/top-down';
import type { SocialToast as Toast, SocialToastQueue } from '../ping/socialToasts';
import { firstName } from './peopleStatus';
import { Button } from './ui/Button';

const SHOW_MS = 10_000;

const COPY: Record<Toast['kind'], { text: (name: string) => string; action: (name: string) => string }> = {
  ping: { text: (name) => `${name} pinged you`, action: (name) => `Go to ${name}` },
  invite: { text: (name) => `${name} invites you to talk`, action: () => 'Join' },
  wave: { text: (name) => `${name} waved at you`, action: () => 'Wave back' },
};

const selectPresent = (id: PlayerId) => (s: OfficeState) => id in s.players;

export function SocialToastView({ queue, store, paused, onWaveBack }: { queue: SocialToastQueue; store: Store; paused: boolean; onWaveBack: (id: PlayerId) => void }) {
  const toast = useSyncExternalStore(queue.subscribe, queue.getSnapshot)[0];
  const present = useStoreSelector(store, selectPresent(toast?.fromId ?? ''));
  const { goTo } = usePlayControls();
  const id = toast?.id;
  useEffect(() => {
    if (id === undefined || paused) {
      return;
    }
    const timer = setTimeout(() => queue.dismiss(id), SHOW_MS);
    return () => clearTimeout(timer);
  }, [id, paused, queue]);
  if (!toast || paused) {
    return null;
  }
  const copy = COPY[toast.kind];
  const act = () => {
    if (toast.kind === 'wave') {
      onWaveBack(toast.fromId);
    } else {
      goTo(toast.fromId);
    }
    queue.dismiss(toast.id);
    focusWorld();
  };
  return (
    <div role="status" className="hud-glass pointer-events-auto flex min-h-14 w-[min(358px,calc(100vw-24px))] items-center gap-2 rounded-hud-panel border border-hud-edge py-1 pr-1 pl-4 font-hud-body shadow-hud-panel">
      <span className="line-clamp-2 min-w-0 flex-1 text-sm leading-5 font-semibold text-hud-text">{copy.text(toast.name)}</span>
      <Button tone="primary" size="sm" className="min-h-12 shrink-0" disabled={!present} onClick={act}>
        {copy.action(firstName(toast.name))}
      </Button>
      <Button tone="ghost" size="sm" className="min-h-12 shrink-0" onClick={() => queue.dismiss(toast.id)}>
        Dismiss
      </Button>
    </div>
  );
}
