import { useCallback, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { JaaSMeeting } from '@jitsi/react-sdk';
import type { JaasVoiceAdapter } from './JaasVoiceAdapter';

const useShareState = (voice: JaasVoiceAdapter) => useSyncExternalStore(voice.onShareChange, voice.getShareState);

// Kept in-viewport but invisible: fully off-screen, Chrome throttles the iframe's timers and the XMPP connection never completes.
const HIDDEN: CSSProperties = { bottom: 0, right: 0, opacity: 0, zIndex: -1 };
const SHOWING_SHARE: CSSProperties = { top: 64, right: 12, borderRadius: 4, overflow: 'hidden', zIndex: 10 };

/**
 * Renders the JaaS iframe for the room the adapter is in: invisible for voice,
 * shown as a HUD panel while someone else in the call shares their screen.
 */
export function JaasMeeting({ voice }: { voice: JaasVoiceAdapter }) {
  const subscribe = useCallback((onChange: () => void) => voice.onMeetingChange(onChange), [voice]);
  const meeting = useSyncExternalStore(subscribe, () => voice.getMeeting());
  const { viewing } = useShareState(voice);
  if (!meeting) {
    return null;
  }
  const startMuted = voice.isMuted();
  return (
    <div
      key={meeting.key}
      style={{ position: 'fixed', width: 480, height: 270, pointerEvents: 'none', ...(viewing ? SHOWING_SHARE : HIDDEN) }}
    >
      <JaaSMeeting
        appId={voice.options.appId}
        jwt={meeting.jwt}
        roomName={meeting.roomName}
        configOverwrite={{
          startWithAudioMuted: startMuted,
          startWithVideoMuted: true,
          prejoinPageEnabled: false,
          prejoinConfig: { enabled: false },
          disableModeratorIndicator: true,
          enableNoisyMicDetection: false,
          disableDeepLinking: true,
          lobby: { autoKnock: true, enableChat: false },
        }}
        interfaceConfigOverwrite={{ TOOLBAR_BUTTONS: [], SHOW_JITSI_WATERMARK: false, SHOW_WATERMARK_FOR_GUESTS: false }}
        userInfo={{ displayName: voice.options.displayName, email: '' }}
        onApiReady={(api) => voice.attachApi(meeting, api, startMuted)}
      />
    </div>
  );
}

export function MuteToggle({ voice }: { voice: JaasVoiceAdapter }) {
  const [muted, setMuted] = useState(voice.isMuted());
  const toggle = () => {
    voice.setMuted(!muted);
    setMuted(!muted);
  };
  // preventDefault on mousedown keeps focus off the button, so Space/Enter keep driving the world.
  return (
    <button
      type="button"
      aria-pressed={muted}
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
      className={`pointer-events-auto rounded px-3 py-1.5 text-xs text-white ${muted ? 'bg-red-700/80 hover:bg-red-700' : 'bg-black/55 hover:bg-black/70'}`}
    >
      Mute mic
    </button>
  );
}

export function ShareScreenToggle({ voice }: { voice: JaasVoiceAdapter }) {
  const { canShare, sharing } = useShareState(voice);
  return (
    <button
      type="button"
      aria-pressed={sharing}
      disabled={!canShare}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => voice.toggleShareScreen()}
      className={`pointer-events-auto rounded px-3 py-1.5 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50 ${sharing ? 'bg-green-700/80 hover:bg-green-700' : 'bg-black/55 hover:bg-black/70'}`}
    >
      Share screen
    </button>
  );
}
