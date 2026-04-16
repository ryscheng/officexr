interface CrosshairProps {
  visible: boolean;
}

export default function Crosshair({ visible }: CrosshairProps) {
  if (!visible) return null;
  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      zIndex: 100,
    }}>
      <svg width="32" height="32" viewBox="-16 -16 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="0"   y1="-14" x2="0"  y2="-5"  stroke="white" strokeWidth="1.5" strokeOpacity="0.85"/>
        <line x1="0"   y1="5"   x2="0"  y2="14"  stroke="white" strokeWidth="1.5" strokeOpacity="0.85"/>
        <line x1="-14" y1="0"   x2="-5" y2="0"   stroke="white" strokeWidth="1.5" strokeOpacity="0.85"/>
        <line x1="5"   y1="0"   x2="14" y2="0"   stroke="white" strokeWidth="1.5" strokeOpacity="0.85"/>
        <circle cx="0" cy="0" r="1.5" fill="white" fillOpacity="0.9"/>
      </svg>
    </div>
  );
}
