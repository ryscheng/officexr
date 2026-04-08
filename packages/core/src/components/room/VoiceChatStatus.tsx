interface VoiceChatStatusProps {
  jitsiRoom: string | null;
  jitsiConnected: boolean;
  jitsiParticipantCount: number;
  remoteAudioLevel: number;
  jaasJwt: string | null;
  jaasJwtError: string | null;
}

export default function VoiceChatStatus({
  jitsiRoom,
  jitsiConnected,
  jitsiParticipantCount,
  remoteAudioLevel,
  jaasJwt,
  jaasJwtError,
}: VoiceChatStatusProps) {
  let bg: string;
  let icon: string;
  let label: string;
  const missing = [
    !import.meta.env.VITE_JAAS_APP_ID     && 'VITE_JAAS_APP_ID',
    !import.meta.env.VITE_JAAS_API_KEY_ID && 'VITE_JAAS_API_KEY_ID',
    !import.meta.env.VITE_JAAS_PRIVATE_KEY && 'VITE_JAAS_PRIVATE_KEY',
  ].filter(Boolean) as string[];
  const jaasConfigured = missing.length === 0;

  if (jaasJwtError) {
    bg = 'rgba(185, 28, 28, 0.92)';
    icon = '❌';
    label = `Voice chat credential error: ${jaasJwtError}`;
  } else if (!jaasConfigured) {
    bg = 'rgba(75, 85, 99, 0.92)';
    icon = '⚙️';
    label = `Voice chat not configured — missing: ${missing.join(', ')}`;
  } else if (!jaasJwt) {
    bg = 'rgba(75, 85, 99, 0.92)';
    icon = '⏳';
    label = 'Voice chat initializing…';
  } else if (!jitsiRoom) {
    bg = 'rgba(55, 65, 81, 0.92)';
    icon = '🔇';
    label = 'Walk near others to voice chat';
  } else if (jitsiConnected) {
    bg = 'rgba(0, 160, 90, 0.92)';
    icon = '🟢';
    label = `Voice active · ${jitsiParticipantCount} in call`;
  } else {
    bg = 'rgba(180, 120, 0, 0.92)';
    icon = '🟡';
    label = 'Voice connecting…';
  }

  return (
    <div
      style={{
        position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
        background: bg,
        borderRadius: '8px', padding: '8px 16px', color: 'white', zIndex: 200,
        display: 'flex', alignItems: 'center', gap: '10px', fontFamily: 'monospace',
        boxShadow: '0 2px 12px rgba(0,0,0,0.4)', transition: 'background 0.4s',
      }}
    >
      <span style={{ fontSize: '16px' }}>{icon}</span>
      <span style={{ fontSize: '13px' }}>{label}</span>
      {jitsiConnected && (
        <div title="Remote audio level" style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {[0.15, 0.35, 0.55, 0.75, 0.95].map((thresh, i) => (
            <div key={i} style={{
              width: '4px',
              height: `${8 + i * 3}px`,
              borderRadius: '2px',
              background: remoteAudioLevel >= thresh
                ? (thresh > 0.7 ? '#f87171' : thresh > 0.45 ? '#fbbf24' : '#4ade80')
                : 'rgba(255,255,255,0.25)',
              transition: 'background 0.1s',
            }} />
          ))}
        </div>
      )}
    </div>
  );
}
