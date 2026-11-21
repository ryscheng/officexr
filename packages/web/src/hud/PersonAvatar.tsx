import type { PlayerId } from '@officexr/sdk';
import type { PersonStatus } from './peopleStatus';
import { PortraitFace } from './PortraitFace';
import { usePlayerPortrait } from './playerPortrait';

export function PersonAvatar({ id, label, status, dim = false }: { id: PlayerId; label: string; status: PersonStatus; dim?: boolean }) {
  const portrait = usePlayerPortrait(id);
  return (
    <span className={`relative flex size-10 shrink-0 items-center justify-center rounded-full bg-hud-avatar text-base font-semibold text-hud-text uppercase ${dim ? 'opacity-60' : ''}`}>
      <PortraitFace src={portrait} initial={label.charAt(0)} />
      <span aria-hidden className={`absolute right-0 bottom-0 size-3 rounded-full border-2 border-hud-panel-solid ${status.dot}`} />
    </span>
  );
}
