import { useEffect, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { MotionPermission, MotionDebug } from '@/hooks/useMotionControls';

interface ControlsOverlayProps {
  /** Panel heading */
  title?: string;
  motionPermission: MotionPermission;
  onRecalibrate: () => void;
  onDisableMotion: () => void;
  /** Show "Enter — Chat" hint (RoomScene) */
  showChat?: boolean;
  /** Show proximity hint below controls (UserLobby) */
  proximityHint?: string;
  /** Extra content rendered at the bottom of the panel */
  extras?: ReactNode;
  /** Optional debug ref from useMotionControls — shows live sensor values */
  motionDebugRef?: RefObject<MotionDebug | null>;
}

/**
 * Shared top-left controls overlay rendered by both RoomScene and UserLobby.
 * Adapts displayed instructions to whether device motion or mouse look is active.
 */
export default function ControlsOverlay({
  title = 'Controls:',
  motionPermission,
  onRecalibrate,
  onDisableMotion,
  showChat = false,
  proximityHint,
  extras,
  motionDebugRef,
}: ControlsOverlayProps) {
  const [dbg, setDbg] = useState<MotionDebug | null>(null);

  // Poll the debug ref at ~10 Hz when motion is active
  useEffect(() => {
    if (motionPermission !== 'granted' || !motionDebugRef) return;
    const id = setInterval(() => setDbg(motionDebugRef.current ? { ...motionDebugRef.current } : null), 100);
    return () => clearInterval(id);
  }, [motionPermission, motionDebugRef]);

  return (
    <div style={{
      position: 'absolute', top: '20px', left: '20px',
      color: 'white', background: 'rgba(0,0,0,0.7)',
      padding: '15px', borderRadius: '8px', fontFamily: 'monospace', zIndex: 100,
    }}>
      <h3 style={{ margin: '0 0 10px 0' }}>{title}</h3>
      <p style={{ margin: '5px 0' }}>W/A/S/D or Arrow Keys — Move</p>

      {motionPermission === 'granted' ? (
        <>
          <p style={{ margin: '5px 0', color: '#4ade80' }}>📱 Tilt device — Look Around</p>
          <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
            <button
              onClick={onRecalibrate}
              style={{
                flex: 1, padding: '4px 8px', fontSize: '12px',
                background: 'rgba(255,255,255,0.15)', color: 'white',
                border: '1px solid rgba(255,255,255,0.3)', borderRadius: '4px', cursor: 'pointer',
              }}
            >
              ↺ Recalibrate
            </button>
            <button
              onClick={onDisableMotion}
              style={{
                flex: 1, padding: '4px 8px', fontSize: '12px',
                background: 'rgba(239,68,68,0.25)', color: '#fca5a5',
                border: '1px solid rgba(239,68,68,0.4)', borderRadius: '4px', cursor: 'pointer',
              }}
            >
              ✕ Disable
            </button>
          </div>

          {/* Debug panel — remove once pitch issue is diagnosed */}
          {dbg && (
            <div style={{ marginTop: '8px', fontSize: '10px', color: '#fde68a', lineHeight: '1.5' }}>
              <div>screen∠={dbg.screenAngle}°</div>
              <div>α={dbg.alpha.toFixed(1)}° β={dbg.beta.toFixed(1)}° γ={dbg.gamma.toFixed(1)}°</div>
              <div>rawPitch={dbg.rawPitch.toFixed(1)}° Δpitch={dbg.deltaPitch.toFixed(2)}°</div>
              <div>Δyaw={dbg.deltaAlpha.toFixed(2)}°</div>
            </div>
          )}
        </>
      ) : (
        <>
          <p style={{ margin: '5px 0' }}>Click Scene — Enable Mouse Look</p>
          <p style={{ margin: '5px 0' }}>Mouse — Look Around (when active)</p>
          <p style={{ margin: '5px 0' }}>Esc — Exit Mouse Look</p>
        </>
      )}

      {showChat && <p style={{ margin: '5px 0' }}>Enter — Chat</p>}

      {proximityHint && (
        <p style={{ margin: '6px 0 0 0', fontSize: '11px', color: '#7dd3fc' }}>
          {proximityHint}
        </p>
      )}

      {extras}
    </div>
  );
}
