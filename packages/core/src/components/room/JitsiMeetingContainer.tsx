import { JaaSMeeting } from '@jitsi/react-sdk';

interface JitsiMeetingContainerProps {
  retryCount: number;
  roomName: string;
  appId: string;
  jwt: string;
  displayName: string;
  email: string;
  onApiReady: (api: any) => void;
}

export default function JitsiMeetingContainer({
  retryCount,
  roomName,
  appId,
  jwt,
  displayName,
  email,
  onApiReady,
}: JitsiMeetingContainerProps) {
  // Kept in-viewport but invisible (opacity:0). Positioning fully off-screen causes Chrome to
  // throttle the iframe's JS timers, preventing Jitsi's XMPP connection from completing.
  return (
    <div key={`${retryCount}-${roomName}`} style={{
      position: 'fixed', bottom: 0, right: 0,
      width: '480px', height: '270px',
      opacity: 0, pointerEvents: 'none', zIndex: -1,
    }}>
      <JaaSMeeting
        appId={appId}
        jwt={jwt}
        roomName={roomName}
        configOverwrite={{
          startWithAudioMuted: false,
          startWithVideoMuted: true,
          prejoinPageEnabled: false,
          prejoinConfig: { enabled: false },
          disableModeratorIndicator: true,
          enableNoisyMicDetection: false,
          disableDeepLinking: true,
          lobby: { autoKnock: true, enableChat: false },
        }}
        interfaceConfigOverwrite={{
          TOOLBAR_BUTTONS: [],
          SHOW_JITSI_WATERMARK: false,
          SHOW_WATERMARK_FOR_GUESTS: false,
        }}
        userInfo={{ displayName, email }}
        getIFrameRef={(iframeRef) => {
          iframeRef.style.width = '480px';
          iframeRef.style.height = '270px';
          (iframeRef as unknown as HTMLIFrameElement).allow =
            'camera; microphone; display-capture; autoplay; screen-wake-lock';
          const observer = new IntersectionObserver(([entry]) => {
            console.log('[VoiceChat] iframe IntersectionObserver — isIntersecting:', entry.isIntersecting, '| intersectionRatio:', entry.intersectionRatio, '| boundingClientRect:', JSON.stringify(entry.boundingClientRect));
            observer.disconnect();
          });
          observer.observe(iframeRef);
        }}
        onApiReady={onApiReady}
      />
    </div>
  );
}
