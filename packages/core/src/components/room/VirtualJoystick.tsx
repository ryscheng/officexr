interface VirtualJoystickProps {
  joystickKnob: { x: number; y: number };
  joystickActive: boolean;
  joystickInputRef: React.MutableRefObject<{ x: number; y: number }>;
  onActiveChange: (active: boolean) => void;
  onKnobChange: (knob: { x: number; y: number }) => void;
}

export default function VirtualJoystick({
  joystickKnob,
  joystickActive,
  joystickInputRef,
  onActiveChange,
  onKnobChange,
}: VirtualJoystickProps) {
  return (
    <div
      onTouchStart={e => {
        e.preventDefault();
        onActiveChange(true);
      }}
      onTouchMove={e => {
        e.preventDefault();
        const touch = e.touches[0];
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        let dx = touch.clientX - cx;
        let dy = touch.clientY - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const maxR = 45;
        if (dist > maxR) {
          dx = (dx / dist) * maxR;
          dy = (dy / dist) * maxR;
        }
        onKnobChange({ x: dx, y: dy });
        joystickInputRef.current = { x: dx / maxR, y: dy / maxR };
      }}
      onTouchEnd={() => {
        onActiveChange(false);
        onKnobChange({ x: 0, y: 0 });
        joystickInputRef.current = { x: 0, y: 0 };
      }}
      style={{
        position: 'absolute', bottom: '100px', left: '40px',
        width: '120px', height: '120px', borderRadius: '50%',
        background: 'rgba(255,255,255,0.12)',
        border: '2px solid rgba(255,255,255,0.25)',
        zIndex: 200, touchAction: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: '52px', height: '52px', borderRadius: '50%',
        background: joystickActive ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)',
        border: '2px solid rgba(255,255,255,0.5)',
        transform: `translate(${joystickKnob.x}px, ${joystickKnob.y}px)`,
        transition: joystickActive ? 'none' : 'transform 0.15s ease-out',
        pointerEvents: 'none',
      }} />
    </div>
  );
}
