import { Smartphone } from 'lucide-react';
import { useMediaQuery } from '@officexr/world/top-down';
import { Panel, PanelTitle } from './ui/Panel';

/** Covers the office on a touch device held upright; the HUD and session underneath keep running. */
export function RotatePrompt() {
  const upright = useMediaQuery('(pointer: coarse) and (orientation: portrait)');
  if (!upright) {
    return null;
  }
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <Panel role="alert" className="flex max-w-xs flex-col items-center gap-3 p-6 text-center">
        <Smartphone aria-hidden className="size-12 text-hud-accent motion-safe:animate-hud-turn" />
        <PanelTitle className="text-lg">Turn your phone</PanelTitle>
        <p className="text-sm text-hud-text-2">
          The office plays sideways. Rotate to landscape to keep going; you stay connected and in your call.
        </p>
      </Panel>
    </div>
  );
}
