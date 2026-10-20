import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { JaaSMeeting } from '@jitsi/react-sdk';
import type { JaasVoiceAdapter } from './JaasVoiceAdapter';

/** Jitsi room names become XMPP JIDs, so logins like `a@b.co` must not leak `@` or `.` into them. */
const jitsiRoomName = (room: string) => room.toLowerCase().replace(/[^a-z0-9-]/g, '-');

function useVoiceRoom(voice: JaasVoiceAdapter): string | null {
  const subscribe = useCallback((onChange: () => void) => voice.on('connection-state-change', onChange), [voice]);
  return useSyncExternalStore(subscribe, () => voice.getCurrentRoom());
}

/** Renders the hidden audio-only JaaS iframe for the room the adapter is in. */
export function JaasMeeting({ voice }: { voice: JaasVoiceAdapter }) {
  const room = useVoiceRoom(voice);
  const [jwt, setJwt] = useState<string | null>(null);
  useEffect(() => {
    voice.options.jwt.then(setJwt, (err: Error) => console.error('JaaS JWT generation failed:', err));
  }, [voice]);

  if (!room || !jwt) {
    return null;
  }
  // Kept in-viewport but invisible: fully off-screen, Chrome throttles the iframe's timers and the XMPP connection never completes.
  return (
    <div
      key={room}
      style={{ position: 'fixed', bottom: 0, right: 0, width: 480, height: 270, opacity: 0, pointerEvents: 'none', zIndex: -1 }}
    >
      <JaaSMeeting
        appId={voice.options.appId}
        jwt={jwt}
        roomName={jitsiRoomName(room)}
        configOverwrite={{
          startWithAudioMuted: voice.isMuted(),
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
        onApiReady={(api) => voice.attachApi(room, api)}
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
  return (
    <button
      type="button"
      aria-pressed={muted}
      onClick={toggle}
      className="absolute right-3 bottom-3 rounded bg-black/55 px-3 py-1.5 text-xs text-white hover:bg-black/70"
    >
      {muted ? 'Unmute mic' : 'Mute mic'}
    </button>
  );
}
