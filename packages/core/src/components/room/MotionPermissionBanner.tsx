interface MotionPermissionBannerProps {
  onEnable: () => void;
}

export default function MotionPermissionBanner({ onEnable }: MotionPermissionBannerProps) {
  return (
    <div style={{
      position: 'absolute', bottom: '30px', left: '50%',
      transform: 'translateX(-50%)', zIndex: 200,
      background: 'rgba(0,0,0,0.85)', color: 'white',
      padding: '14px 20px', borderRadius: '10px',
      fontFamily: 'monospace', textAlign: 'center',
      border: '1px solid rgba(255,255,255,0.2)',
      display: 'flex', alignItems: 'center', gap: '12px',
    }}>
      <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)' }}>
        Enable gyroscope to look around by moving your device
      </span>
      <button
        onClick={onEnable}
        style={{
          padding: '8px 16px', background: '#6366f1', color: 'white',
          border: 'none', borderRadius: '6px', cursor: 'pointer',
          fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap',
        }}
      >
        Enable Motion
      </button>
    </div>
  );
}
