import type { Store } from '@officexr/sdk';
import { MuteToggle, ShareScreenToggle } from './JaasMeeting';
import type { JaasVoiceAdapter } from './JaasVoiceAdapter';
import { ZoneCallLabel } from './ZoneCallLabel';

export function CallBar({ store, voice }: { store: Store; voice: JaasVoiceAdapter }) {
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-lg bg-black/40 p-1">
      <ZoneCallLabel store={store} />
      <ShareScreenToggle voice={voice} />
      <MuteToggle voice={voice} />
    </div>
  );
}
