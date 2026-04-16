import { useEffect, useState } from 'react';

interface ConnectionStatusBannerProps {
  // Realtime channel
  realtimeRetryAt: number | null;
  // Voice call
  jitsiRoom: string | null;
  jitsiConnected: boolean;
  jitsiParticipantCount: number;
  remoteAudioLevel: number;
  jaasJwt: string | null;
  jaasJwtError: string | null;
  jitsiError: string | null;
  onJitsiRetry: () => void;
  onJitsiDismiss: () => void;
}

export default function ConnectionStatusBanner({
  realtimeRetryAt,
  jitsiRoom,
  jitsiConnected,
  jitsiParticipantCount,
  remoteAudioLevel,
  jaasJwt,
  jaasJwtError,
  jitsiError,
  onJitsiRetry,
  onJitsiDismiss,
}: ConnectionStatusBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (realtimeRetryAt === null) return;
    setSecondsLeft(Math.max(0, Math.ceil((realtimeRetryAt - Date.now()) / 1000)));
    const id = setInterval(() => {
      const s = Math.max(0, Math.ceil((realtimeRetryAt - Date.now()) / 1000));
      setSecondsLeft(s);
      if (s === 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [realtimeRetryAt]);

  // ── Realtime section ─────────────────────────────────────────────────────
  const realtimeOk = realtimeRetryAt === null;
  const realtimeDot = realtimeOk ? '#4ade80' : '#f97316';
  const realtimeLabel = realtimeOk
    ? 'Live'
    : secondsLeft > 0
      ? `Lost connection — retrying in ${secondsLeft}s`
      : 'Reconnecting…';

  // ── Voice section ────────────────────────────────────────────────────────
  const missing = ([
    !import.meta.env.VITE_JAAS_APP_ID      && 'VITE_JAAS_APP_ID',
    !import.meta.env.VITE_JAAS_API_KEY_ID  && 'VITE_JAAS_API_KEY_ID',
    !import.meta.env.VITE_JAAS_PRIVATE_KEY && 'VITE_JAAS_PRIVATE_KEY',
  ] as (string | false)[]).filter(Boolean) as string[];
  const jaasConfigured = missing.length === 0;

  let voiceIcon: string;
  let voiceLabel: string;
  let voiceIsError = false;

  if (jitsiError) {
    voiceIcon = '⚠️';
    voiceLabel = jitsiError;
    voiceIsError = true;
  } else if (jaasJwtError) {
    voiceIcon = '❌';
    voiceLabel = `Voice credential error: ${jaasJwtError}`;
    voiceIsError = true;
  } else if (!jaasConfigured) {
    voiceIcon = '⚙️';
    voiceLabel = `Voice not configured — missing: ${missing.join(', ')}`;
  } else if (!jaasJwt) {
    voiceIcon = '⏳';
    voiceLabel = 'Voice initializing…';
  } else if (!jitsiRoom) {
    voiceIcon = '🔇';
    voiceLabel = 'Walk near others to voice chat';
  } else if (jitsiConnected) {
    voiceIcon = '🟢';
    voiceLabel = `Voice · ${jitsiParticipantCount} in call`;
  } else {
    voiceIcon = '🟡';
    voiceLabel = 'Voice connecting…';
  }

  return (
    <div style={{
      position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(15, 23, 42, 0.88)',
      borderRadius: '8px', padding: '8px 14px', color: 'white', zIndex: 300,
      display: 'flex', alignItems: 'center', gap: '12px',
      fontFamily: 'monospace', fontSize: '13px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
      maxWidth: '90vw',
    }}>

      {/* Realtime status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
        <span style={{
          width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
          background: realtimeDot, boxShadow: `0 0 6px ${realtimeDot}`,
        }} />
        <span style={{ color: realtimeOk ? 'rgba(255,255,255,0.7)' : '#fb923c' }}>
          {realtimeLabel}
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.18)', flexShrink: 0 }} />

      {/* Voice status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '14px', lineHeight: 1 }}>{voiceIcon}</span>
        <span style={{ color: voiceIsError ? '#fca5a5' : 'rgba(255,255,255,0.7)' }}>
          {voiceLabel}
        </span>

        {jitsiConnected && (
          <div title="Remote audio level" style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            {[0.15, 0.35, 0.55, 0.75, 0.95].map((thresh, i) => (
              <div key={i} style={{
                width: '4px', height: `${8 + i * 3}px`, borderRadius: '2px',
                background: remoteAudioLevel >= thresh
                  ? (thresh > 0.7 ? '#f87171' : thresh > 0.45 ? '#fbbf24' : '#4ade80')
                  : 'rgba(255,255,255,0.22)',
                transition: 'background 0.1s',
              }} />
            ))}
          </div>
        )}

        {jitsiError && (
          <>
            {jitsiRoom && (
              <button onClick={onJitsiRetry} style={{
                background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.28)',
                color: 'white', cursor: 'pointer', fontSize: '12px',
                padding: '3px 9px', borderRadius: '4px', flexShrink: 0,
              }}>
                Retry
              </button>
            )}
            <button onClick={onJitsiDismiss} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)',
              cursor: 'pointer', fontSize: '17px', lineHeight: 1, padding: 0, flexShrink: 0,
            }}>
              ×
            </button>
          </>
        )}
      </div>
    </div>
  );
}
