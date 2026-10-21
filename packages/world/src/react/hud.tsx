import type { CameraMode } from '../renderer/config.ts';

export type HudRealtime = 'in-memory' | 'ws';

/**
 * Top-right chip showing whether the 3D canvas owns keyboard input.
 * Pointer-events: none so clicking the chip doesn't count as a "focus
 * the world" mousedown — the user has to click the canvas behind it.
 */
export function FocusIndicator({ focused }: { focused: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        padding: '6px 10px',
        background: focused ? 'rgba(0,0,0,0.55)' : 'rgba(146, 64, 14, 0.85)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 4,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        animation: focused ? undefined : 'officexr-focus-pulse 1.6s ease-in-out infinite',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: focused ? '#22c55e' : '#fbbf24',
          boxShadow: focused ? '0 0 6px #22c55e' : '0 0 6px #fbbf24',
        }}
      />
      {focused ? 'Controls active' : 'Click world to control'}
      <style>{`
        @keyframes officexr-focus-pulse {
          0%, 100% { opacity: 0.85; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export function WorldHud({
  cameraMode,
  realtime,
  bakedLayoutName,
}: {
  cameraMode: CameraMode;
  realtime: HudRealtime;
  /** Shown because the unbaked fallback is otherwise silent (a console.warn). */
  bakedLayoutName?: string;
}) {
  const layoutLine = bakedLayoutName
    ? `Layout: baked "${bakedLayoutName}"`
    : 'Layout: unbaked (instanced objects)';
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        padding: '6px 10px',
        background: 'rgba(0,0,0,0.55)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 4,
        pointerEvents: 'none',
        whiteSpace: 'pre-line',
      }}
    >
      {`Camera: ${cameraMode} (Alt+P to cycle) · Realtime: ${realtime} · ${layoutLine}
WASD to move · Click to look · Esc to release mouse`}
    </div>
  );
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 14px',
        background: 'rgba(180, 50, 50, 0.92)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 6,
        cursor: 'pointer',
        maxWidth: '90vw',
      }}
      onClick={onDismiss}
      title="click to dismiss"
    >
      {message}
    </div>
  );
}
