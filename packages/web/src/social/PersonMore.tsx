import type { ReactNode } from 'react';
import { Flag, UserX } from 'lucide-react';
import { InlineAlert } from '../hud/ui/InlineAlert';

function Action({ icon, title, hint, disabled, onClick }: { icon: ReactNode; title: string; hint: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 rounded-hud-control border border-hud-edge px-3 py-2 text-left hover:bg-hud-hover focus-visible:outline-2 focus-visible:outline-hud-accent disabled:opacity-40"
    >
      {icon}
      <span className="min-w-0">
        <span className="block text-base leading-6 font-semibold text-hud-text">{title}</span>
        <span className="block text-sm leading-5 text-hud-text-2">{hint}</span>
      </span>
    </button>
  );
}

export function PersonMore({
  name,
  canBlock,
  canReport,
  busy,
  failed,
  onBlock,
  onReport,
}: {
  name: string;
  canBlock: boolean;
  canReport: boolean;
  busy: boolean;
  failed: boolean;
  onBlock: () => void;
  onReport: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-1">
      {canBlock && (
        <Action icon={<UserX aria-hidden className="size-5 shrink-0 text-hud-text-2" />} title={`Block ${name}`} hint="You will not see or hear each other." disabled={busy} onClick={onBlock} />
      )}
      {canReport && (
        <Action icon={<Flag aria-hidden className="size-5 shrink-0 text-hud-text-2" />} title={`Report ${name}`} hint="Tell an admin about a problem." onClick={onReport} />
      )}
      {failed && <InlineAlert>Could not block. Try again.</InlineAlert>}
    </div>
  );
}
