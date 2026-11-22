import { LogOut, MicOff } from 'lucide-react';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { RoundButton } from './RoundButton';
import { Panel } from './ui/Panel';

export function TextOnlyCall({ voice }: { voice: JaasVoiceAdapter | null }) {
  return (
    <Panel role="status" className="pointer-events-auto flex h-14 w-[min(358px,calc(100vw-24px))] items-center gap-2 p-1 pr-1">
      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-hud-amber text-hud-amber-text pointer-coarse:size-12">
        <MicOff className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col pr-1">
        <span className="w-fit rounded-md bg-hud-amber px-1.5 text-xs/4 font-semibold text-hud-amber-text">Text only</span>
        <span className="truncate text-xs/4 text-hud-text-2">Mic off · chat works</span>
      </span>
      {voice && (
        <RoundButton className="size-12" aria-label="Leave call" tone="danger" onClick={() => void voice.leaveRoom()}>
          <LogOut aria-hidden className="size-5" />
        </RoundButton>
      )}
    </Panel>
  );
}
