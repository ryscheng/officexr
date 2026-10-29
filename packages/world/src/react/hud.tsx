import type { ReactNode } from 'react';
import type { BakedLayoutPlacement } from '../app/map-loader.ts';
import type { CameraMode } from '../renderer/config.ts';

export type HudRealtime = 'in-memory' | 'ws';

/**
 * Chip showing whether the 3D canvas owns keyboard input.
 * Pointer-events: none so clicking the chip doesn't count as a "focus
 * the world" mousedown — the user has to click the canvas behind it.
 */
export function FocusIndicator({ focused }: { focused: boolean }) {
  return (
    <div
      style={{
        flexShrink: 0,
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

const HUD_INSET = 12;
const HUD_GAP = 8;
/** Mirrors the host menu button's size in `@officexr/web`'s `RoomMenu`. */
const HOST_MENU_SLOT = 44;

/** Top-left row for the status line and focus chip; `reserveMenuSlot` leaves room for the host's menu button. */
export function TopLeftHud({ reserveMenuSlot = false, children }: { reserveMenuSlot?: boolean; children: ReactNode }) {
  const left = reserveMenuSlot ? HUD_INSET + HOST_MENU_SLOT + HUD_GAP : HUD_INSET;
  return (
    <div
      style={{
        position: 'absolute',
        top: HUD_INSET,
        left,
        maxWidth: `calc(100% - ${left + HUD_INSET}px)`,
        display: 'flex',
        minHeight: reserveMenuSlot ? HOST_MENU_SLOT : undefined,
        alignItems: reserveMenuSlot ? 'center' : 'flex-start',
        gap: HUD_GAP,
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  );
}

/** Flows inside `TopLeftHud`, which positions it. `statusOnly` drops the control instructions, for hosts that document them elsewhere. */
export function WorldHud({
  cameraMode,
  realtime,
  bakedLayouts = [],
  statusOnly = false,
}: {
  cameraMode: CameraMode;
  realtime: HudRealtime;
  statusOnly?: boolean;
  bakedLayouts?: readonly Pick<BakedLayoutPlacement, 'layoutName'>[];
}) {
  const layoutNames = [...new Set(bakedLayouts.map((p) => `"${p.layoutName}"`))];
  const layoutLine = layoutNames.length
    ? `Layouts: baked ${layoutNames.join(', ')}`
    : 'Layouts: none baked (instanced objects)';
  return (
    <div
      style={{
        padding: '6px 10px',
        background: 'rgba(0,0,0,0.55)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 4,
        pointerEvents: 'none',
        whiteSpace: 'pre-line',
      }}
    >
      {`Camera: ${cameraMode}${statusOnly ? '' : ' (Alt+P to cycle)'} · Realtime: ${realtime} · ${layoutLine}`}
      {!statusOnly && '\nWASD to move · Click to look · Esc to release mouse'}
    </div>
  );
}

/** Without `onDismiss` the banner stays until its parent stops rendering it. */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div
      role="alert"
      style={{
        position: 'absolute',
        top: HUD_INSET,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 14px',
        background: 'rgba(180, 50, 50, 0.92)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 6,
        cursor: onDismiss ? 'pointer' : undefined,
        maxWidth: '90vw',
      }}
      onClick={onDismiss}
      title={onDismiss ? 'click to dismiss' : undefined}
    >
      {message}
    </div>
  );
}
