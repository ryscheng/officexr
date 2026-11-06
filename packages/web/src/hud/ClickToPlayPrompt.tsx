import { MousePointer2 } from 'lucide-react';
import { useWorldFocus } from '@officexr/world/top-down';
import { Panel, PanelTitle } from './ui/Panel';

/** Tells the player the world has lost keyboard focus; clicks pass through to the canvas. */
export function ClickToPlayPrompt() {
  if (useWorldFocus()) {
    return null;
  }
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <Panel className="flex items-center gap-4 p-5 motion-safe:animate-hud-bob">
        <span className="flex size-12 items-center justify-center rounded-hud-control bg-hud-accent text-hud-on-accent">
          <MousePointer2 aria-hidden className="size-6" />
        </span>
        <div>
          <PanelTitle className="text-2xl">Click to play</PanelTitle>
          <p className="text-sm text-hud-text-2">Click the world to move and look around</p>
        </div>
      </Panel>
    </div>
  );
}
