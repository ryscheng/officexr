import { CameraMode } from '@/types/room';

interface CameraModeIndicatorProps {
  cameraMode: CameraMode;
  isTouchDevice: boolean;
}

export default function CameraModeIndicator({ cameraMode, isTouchDevice }: CameraModeIndicatorProps) {
  if (cameraMode === 'first-person') return null;
  return (
    <div style={{
      position: 'absolute',
      bottom: isTouchDevice ? '180px' : '20px',
      left: isTouchDevice ? '40px' : '20px',
      background: 'rgba(0,0,0,0.7)', color: 'white', padding: '6px 12px',
      borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', zIndex: 200,
      pointerEvents: 'none',
    }}>
      {cameraMode === 'third-person-behind' ? '3rd Person (Front)' : '3rd Person (Behind)'}
      <span style={{ color: '#9ca3af', marginLeft: '8px' }}>C to cycle</span>
    </div>
  );
}
