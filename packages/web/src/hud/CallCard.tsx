import { useId, useState } from 'react';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, LogOut, Mic, MicOff, MonitorOff, MonitorUp } from 'lucide-react';
import type { OfficeState, PlayerId, Store } from '@officexr/sdk';
import { deriveZoneRoom } from '@officexr/core-refactor';
import { useStoreSelector } from '@officexr/world/top-down';
import type { PingSender } from '../ping/usePingSender';
import { useShareState } from '../voice/JaasMeeting';
import { useMicMuted } from '../voice/useMicMuted';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { CallList, useCallSummary } from './CallList';
import { useFold } from './foldPrefs';
import { formatDistance } from './formatDistance';
import { PortraitFace } from './PortraitFace';
import { usePlayerPortrait } from './playerPortrait';
import { RoundButton } from './RoundButton';
import { Panel } from './ui/Panel';
import { useEscapeLayer } from './useEscapeLayer';

const selectZoneLabel = (s: OfficeState) => {
  const room = s.players[s.selfId]?.jitsiRoom;
  return room ? (s.voiceZones.find((z) => room === deriveZoneRoom(s.officeId, z.id))?.label ?? null) : null;
};

export function CallCard({
  store,
  selfId,
  voice,
  pinger,
  compact = false,
}: {
  store: Store;
  selfId: PlayerId;
  voice: JaasVoiceAdapter;
  pinger?: PingSender;
  compact?: boolean;
}) {
  const { state, count, others, firstId, firstLabel, soloDistanceM } = useCallSummary(store);
  const zone = useStoreSelector(store, selectZoneLabel);
  const muted = useMicMuted(voice);
  const { canShare, sharing } = useShareState(voice);
  const [open, setOpen] = useState(false);
  const trayId = useId();
  const portrait = usePlayerPortrait(firstId);
  const fold = useFold('call', false);
  useEscapeLayer(open, () => setOpen(false));
  if (state === 'none') {
    return null;
  }
  const title =
    state === 'joining' ? 'Joining call' : zone ? zone : others === 1 && firstLabel ? `Talking with ${firstLabel}` : `In call · ${count}`;
  const sub =
    soloDistanceM !== null
      ? `Voice ${muted ? 'muted' : 'on'} · ${formatDistance(soloDistanceM)} away`
      : `Voice ${muted ? 'muted' : 'on'}`;
  const initial = firstLabel?.charAt(0).toUpperCase() ?? '·';
  const MuteIcon = muted ? MicOff : Mic;
  const ShareIcon = sharing ? MonitorOff : MonitorUp;

  if (compact || fold.folded) {
    return (
      <Panel className="pointer-events-auto flex h-14 w-[min(358px,calc(100vw-24px))] items-center gap-2 p-1 pl-4">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm/5 font-semibold">{title}</span>
          {compact && <span className="truncate text-xs/4 text-hud-text-2">{sub}</span>}
        </span>
        <RoundButton className="size-12" aria-label={muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={muted} tone={muted ? 'danger' : 'inset'} onClick={() => voice.setMuted(!muted)}>
          <MuteIcon aria-hidden className="size-5" />
        </RoundButton>
        <RoundButton className="size-12" aria-label="Leave call" tone="danger" onClick={() => void voice.leaveRoom()}>
          <LogOut aria-hidden className="size-5" />
        </RoundButton>
        {!compact && (
          <RoundButton aria-label="Expand call card" aria-expanded={false} onClick={fold.toggle}>
            <ChevronsUpDown aria-hidden className="size-4" />
          </RoundButton>
        )}
      </Panel>
    );
  }

  return (
    <div className="pointer-events-none flex flex-col items-end gap-2">
      <Panel className="pointer-events-auto flex w-86 max-w-[calc(100vw-24px)] flex-col gap-3 p-3">
        <div className="flex items-center gap-3">
          <span aria-hidden className="relative flex size-11 shrink-0 rounded-full bg-hud-avatar text-sm font-semibold">
            <PortraitFace src={portrait} initial={initial} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="truncate text-xs text-hud-text-2">{sub}</div>
          </div>
          <RoundButton aria-label="Collapse call card" aria-expanded onClick={fold.toggle}>
            <ChevronsDownUp aria-hidden className="size-4" />
          </RoundButton>
          <RoundButton aria-label={`In call, ${count}`} aria-expanded={open} aria-controls={trayId} onClick={() => setOpen((o) => !o)}>
            <ChevronDown aria-hidden className={`size-4 ${open ? 'rotate-180' : ''}`} />
          </RoundButton>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={muted}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => voice.setMuted(!muted)}
            className={`flex h-11 flex-1 items-center justify-center gap-2 rounded-hud-control text-sm font-semibold ${muted ? 'bg-hud-rose text-hud-rose-text' : 'bg-hud-inset text-hud-text hover:bg-hud-hover'}`}
          >
            <MuteIcon aria-hidden className="size-4" />
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <RoundButton
            aria-label={!canShare ? 'Screen sharing unavailable' : sharing ? 'Stop sharing' : 'Share screen'}
            disabled={!canShare}
            className="w-11 rounded-hud-control disabled:opacity-40"
            onClick={() => voice.toggleShareScreen()}
          >
            <ShareIcon aria-hidden className="size-4" />
          </RoundButton>
          <RoundButton aria-label="Leave call" tone="danger" className="w-11 rounded-hud-control" onClick={() => void voice.leaveRoom()}>
            <LogOut aria-hidden className="size-4" />
          </RoundButton>
        </div>
      </Panel>
      {open && <CallList id={trayId} store={store} selfId={selfId} pinger={pinger} voice={voice} />}
    </div>
  );
}
