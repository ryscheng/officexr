import { useEffect } from 'react';
import { isHotkeyBlocked } from '../room/isHotkeyBlocked';
import type { JaasVoiceAdapter } from './JaasVoiceAdapter';

/** Alt/⌥ + M toggles the microphone, matching the call bar's mute button. */
export function useMuteHotkey(voice: JaasVoiceAdapter) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyM' || e.repeat || isHotkeyBlocked(e)) {
        return;
      }
      e.preventDefault();
      voice.setMuted(!voice.isMicMuted());
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [voice]);
}
