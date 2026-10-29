import { useCallback, useSyncExternalStore } from 'react';
import type { JaasVoiceAdapter } from './JaasVoiceAdapter';

/** Whether the mic is actually off, including a mute Jitsi holds on its own. */
export function useMicMuted(voice: JaasVoiceAdapter): boolean {
  const subscribe = useCallback((onChange: () => void) => voice.onMuteChange(onChange), [voice]);
  return useSyncExternalStore(subscribe, () => voice.isMicMuted());
}
