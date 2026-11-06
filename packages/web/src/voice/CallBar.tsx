import { useId, useState } from 'react';
import { ChevronUp } from 'lucide-react';
import type { PlayerId, Store } from '@officexr/sdk';
import { CallList, useCallRows } from '../hud/CallList';
import { useEscapeLayer } from '../hud/useEscapeLayer';
import { Panel } from '../hud/ui/Panel';
import type { PingSender } from '../ping/usePingSender';
import { MuteToggle, ShareScreenToggle } from './JaasMeeting';
import type { JaasVoiceAdapter } from './JaasVoiceAdapter';
import { ZoneCallLabel } from './ZoneCallLabel';

const PREVIEW_AVATARS = 3;

export function CallBar({
  store,
  selfId,
  voice,
  pinger,
}: {
  store: Store;
  selfId: PlayerId;
  voice: JaasVoiceAdapter;
  pinger?: PingSender;
}) {
  const [open, setOpen] = useState(false);
  useEscapeLayer(open, () => setOpen(false));
  const { state, rows } = useCallRows(store, selfId);
  const trayId = useId();
  return (
    <div className="pointer-events-none flex max-w-full flex-col items-center gap-2">
      {open && <CallList id={trayId} store={store} selfId={selfId} pinger={pinger} />}
      <Panel className="pointer-events-auto flex max-w-full items-center gap-2 p-1.5">
        <MuteToggle voice={voice} />
        <ZoneCallLabel store={store} joining={state === 'joining'} />
        <ShareScreenToggle voice={voice} />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={trayId}
          // Keeps focus on the world so Space/Enter keep driving the avatar.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-hud-control bg-hud-inset px-2 py-1.5 text-xs whitespace-nowrap text-hud-text hover:bg-hud-edge pointer-coarse:min-h-11"
        >
          <span className="flex -space-x-1.5" aria-hidden>
            {rows.slice(0, PREVIEW_AVATARS).map((row) => (
              <span
                key={row.id}
                className="flex h-5 w-5 items-center justify-center rounded-full border border-hud-panel bg-hud-edge text-[9px] font-bold uppercase"
              >
                {row.label.charAt(0)}
              </span>
            ))}
          </span>
          In call · {rows.length}
          <ChevronUp aria-hidden className={`h-3.5 w-3.5 ${open ? 'rotate-180' : ''}`} />
        </button>
      </Panel>
    </div>
  );
}
