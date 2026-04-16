import { useEffect, useState } from 'react';

interface RealtimeStatusBannerProps {
  /** Unix timestamp (ms) when the next reconnect attempt will fire. */
  retryAt: number;
}

export default function RealtimeStatusBanner({ retryAt }: RealtimeStatusBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
  );

  useEffect(() => {
    setSecondsLeft(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));

    const interval = setInterval(() => {
      const s = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setSecondsLeft(s);
      if (s === 0) clearInterval(interval);
    }, 500);

    return () => clearInterval(interval);
  }, [retryAt]);

  const label = secondsLeft > 0
    ? `Retrying in ${secondsLeft}s…`
    : 'Reconnecting…';

  return (
    <div style={{
      position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(120, 53, 15, 0.92)', color: 'white',
      padding: '10px 16px', borderRadius: '8px', zIndex: 300,
      fontFamily: 'monospace', fontSize: '13px',
      display: 'flex', alignItems: 'center', gap: '10px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.5)', maxWidth: '90vw',
      pointerEvents: 'none',
    }}>
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%',
        background: '#f97316', flexShrink: 0,
        boxShadow: '0 0 6px #f97316',
      }} />
      <span>Lost connection to real-time server — {label}</span>
    </div>
  );
}
