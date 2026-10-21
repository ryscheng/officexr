import { useCallback, useState, useSyncExternalStore } from 'react';
import { JaaSMeeting } from '@jitsi/react-sdk';
import type { JaasVoiceAdapter } from './JaasVoiceAdapter';

/** Renders the hidden audio-only JaaS iframe for the room the adapter is in. */
export function JaasMeeting({ voice }: { voice: JaasVoiceAdapter }) {
  const subscribe = useCallback((onChange: () => void) => voice.onMeetingChange(onChange), [voice]);
  const meeting = useSyncExternalStore(subscribe, () => voice.getMeeting());
  if (!meeting) {
    return null;
  }
  const startMuted = voice.isMuted();
  // Kept in-viewport but invisible: fully off-screen, Chrome throttles the iframe's timers and the XMPP connection never completes.
  return (
    <div
      key={meeting.roomName}
      style={{ position: 'fixed', bottom: 0, right: 0, width: 480, height: 270, opacity: 0, pointerEvents: 'none', zIndex: -1 }}
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
      className={`absolute right-3 bottom-3 rounded px-3 py-1.5 text-xs text-white ${muted ? 'bg-red-700/80 hover:bg-red-700' : 'bg-black/55 hover:bg-black/70'}`}
    >
      Mute mic
    </button>
  );
}
