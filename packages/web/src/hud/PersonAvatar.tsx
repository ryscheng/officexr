import type { PersonStatus } from './peopleStatus';

export function PersonAvatar({ label, status, dim = false }: { label: string; status: PersonStatus; dim?: boolean }) {
  return (
    <span className={`relative flex size-10 shrink-0 items-center justify-center rounded-full bg-hud-avatar text-base font-semibold text-hud-text uppercase ${dim ? 'opacity-60' : ''}`}>
      <span aria-hidden>{label.charAt(0)}</span>
      <span aria-hidden className={`absolute right-0 bottom-0 size-3 rounded-full border-2 border-hud-panel-solid ${status.dot}`} />
    </span>
  );
}
