import { X } from 'lucide-react';
import { IconButton } from './IconButton';

/** An error across the top centre; without `onDismiss` it stays until its parent stops rendering it. */
export function HudBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      data-studio-panel
      className="pointer-events-auto absolute top-3 left-1/2 z-30 flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-hud-control border-2 border-hud-rose-text/40 bg-hud-rose py-1.5 pr-1.5 pl-4 font-hud-body text-sm text-hud-rose-text shadow-hud-control"
    >
      <span className="py-1">{message}</span>
      {onDismiss && <IconButton icon={X} label="Dismiss" tone="danger" size="row" onClick={onDismiss} />}
    </div>
  );
}
