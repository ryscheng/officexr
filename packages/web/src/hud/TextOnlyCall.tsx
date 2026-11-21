import { LogOut, MicOff } from 'lucide-react';
import type { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { RoundButton } from './RoundButton';
import { Panel } from './ui/Panel';

export function TextOnlyCall({ voice }: { voice: JaasVoiceAdapter | null }) {
  return (
    <Panel role="status" className="pointer-events-auto flex items-center gap-2 p-1.5 pr-2">
      <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-full bg-hud-amber text-hud-amber-text pointer-coarse:size-12">
        <MicOff className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col pr-1">
        <span className="w-fit rounded-md bg-hud-amber px-1.5 text-xs/4 font-semibold text-hud-amber-text">Text only</span>
        <span className="truncate text-xs/4 text-hud-text-2">Mic off · chat works</span>
      </span>
      {voice && (
        <RoundButton aria-label="Leave call" tone="danger" onClick={() => void voice.leaveRoom()}>
          <LogOut aria-hidden className="size-5" />
        </RoundButton>
      )}
    </Panel>
  );
}
