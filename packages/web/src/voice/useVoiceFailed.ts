import { useSyncExternalStore } from 'react';
import type { JaasVoiceAdapter } from './JaasVoiceAdapter';

const never = () => () => {};

export function useVoiceFailed(voice: JaasVoiceAdapter | null): boolean {
  return useSyncExternalStore(
    voice ? (onChange) => voice.on('connection-state-change', onChange) : never,
    () => voice?.getConnectionState() === 'error',
  );
}
