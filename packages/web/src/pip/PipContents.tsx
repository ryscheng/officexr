import { createPortal } from 'react-dom';
import type { Store } from '@officexr/sdk';
import { TooltipContainer } from '../hud/IconButton';
import { Minimap } from '../hud/Minimap';
import { MuteToggle } from '../voice/JaasMeeting';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';

/** The minimap and mute button, portalled into the picture-in-picture window from inside the room's providers. */
export function PipContents({
  pipWindow,
  store,
  voice,
}: {
  pipWindow: Window;
  store: Store;
  voice: JaasVoiceAdapter | null;
}) {
  const body = pipWindow.document.body;
  return createPortal(
    <TooltipContainer.Provider value={body}>
      <div className="min-h-screen bg-neutral-900 p-2">
        <div className="relative">
          {/* ponytail: Chrome's intensive throttling can slow a long-hidden tab's timers to once a minute, so dots may turn red late. */}
          <Minimap store={store} alwaysOpen />
          {voice && (
            <div className="absolute right-1 bottom-1">
              <MuteToggle voice={voice} />
            </div>
          )}
        </div>
      </div>
    </TooltipContainer.Provider>,
    body,
  );
}
