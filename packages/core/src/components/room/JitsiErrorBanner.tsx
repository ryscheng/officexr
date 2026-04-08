interface JitsiErrorBannerProps {
  error: string;
  jitsiRoom: string | null;
  onRetry: () => void;
  onDismiss: () => void;
}

export default function JitsiErrorBanner({ error, jitsiRoom, onRetry, onDismiss }: JitsiErrorBannerProps) {
  return (
    <div style={{
      position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(185, 28, 28, 0.92)', color: 'white',
      padding: '10px 16px', borderRadius: '8px', zIndex: 300,
      fontFamily: 'monospace', fontSize: '13px',
      display: 'flex', alignItems: 'center', gap: '12px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.5)', maxWidth: '90vw',
    }}>
      <span>⚠️ {error}</span>
      {jitsiRoom && (
        <button
          onClick={onRetry}
          style={{
            background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
            color: 'white', cursor: 'pointer', fontSize: '12px',
            padding: '4px 10px', borderRadius: '4px', flexShrink: 0,
          }}
        >
          Retry
        </button>
      )}
      <button
        onClick={onDismiss}
        style={{
          background: 'none', border: 'none', color: 'white',
          cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: 0, flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}
