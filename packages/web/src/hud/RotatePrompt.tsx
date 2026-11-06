import { useSyncExternalStore } from 'react';
import { Smartphone } from 'lucide-react';
import { Panel, PanelTitle } from './ui/Panel';

const QUERY = '(pointer: coarse) and (orientation: portrait)';

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};

/** Covers the office on a touch device held upright; the HUD and session underneath keep running. */
export function RotatePrompt() {
  const upright = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
  if (!upright) {
    return null;
  }
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <Panel
        role="alertdialog"
        aria-label="Turn your phone"
        className="flex max-w-xs flex-col items-center gap-3 p-6 text-center"
      >
        <Smartphone aria-hidden className="size-12 text-hud-accent motion-safe:animate-hud-turn" />
        <PanelTitle className="text-lg">Turn your phone</PanelTitle>
        <p className="text-sm text-hud-text-2">
          The office plays sideways. Rotate to landscape to keep going; you stay connected and in your call.
        </p>
      </Panel>
    </div>
  );
}
