import { useSyncExternalStore, type ReactNode } from 'react';
import type { BakedLayoutPlacement } from '../app/map-loader.ts';
import { assertNever } from '../renderer/assertNever.ts';
import type { SeatingController, SeatingRefusal } from './useSeating.ts';
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

/** Top-left row for the status line and focus chip. */
export function TopLeftHud({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: HUD_INSET,
        left: HUD_INSET,
        maxWidth: `calc(100% - ${2 * HUD_INSET}px)`,
        display: 'flex',
        alignItems: 'flex-start',
        gap: HUD_GAP,
        pointerEvents: 'none',
      }}
    >
      {children}
    </div>
  );
}

/** Flows inside `TopLeftHud`, which positions it. */
export function WorldHud({
  cameraMode,
  realtime,
  bakedLayouts = [],
}: {
  cameraMode: CameraMode;
  realtime: HudRealtime;
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
      {`Camera: ${cameraMode} (Alt+P to cycle) · Realtime: ${realtime} · ${layoutLine}`}
      {'\nWASD to move · Click to look · Esc to release mouse'}
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

function refusalMessage(reason: SeatingRefusal): string {
  return reason === 'occupied'
    ? 'Someone is already sitting there'
    : reason === 'not-yours'
      ? "That's someone else's desk"
      : reason === 'blocked'
        ? "That chair isn't part of a usable desk"
        : reason === 'not-touching'
          ? 'Walk up to a chair to sit'
          : assertNever(reason);
}

/** Says why the last sit failed, while the seating controller holds the refusal. */
export function SeatRefusalToast({ seating }: { seating: Pick<SeatingController, 'getState' | 'subscribe'> }) {
  const { refusal } = useSyncExternalStore(seating.subscribe, seating.getState);
  if (refusal === null) {
    return null;
  }
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        bottom: 96,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '6px 12px',
        background: 'rgba(0,0,0,0.7)',
        color: '#fff',
        font: '12px system-ui, sans-serif',
        borderRadius: 4,
        pointerEvents: 'none',
      }}
    >
      {refusalMessage(refusal)}
    </div>
  );
}

const TELEPORT_FLASH_MS = 450;

/** A white flash over the view each time the seating controller teleports the player. */
export function TeleportFlash({ seating }: { seating: Pick<SeatingController, 'getState' | 'subscribe'> }) {
  const { teleports } = useSyncExternalStore(seating.subscribe, seating.getState);
  if (teleports === 0) {
    return null;
  }
  return (
    <>
      <style>{`
        @keyframes officexr-teleport-flash {
          0% { opacity: 0.95; }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-teleport-flash] { animation-duration: 150ms !important; }
        }
      `}</style>
      {/* Keyed on the count so each teleport remounts and replays the animation. */}
      <div
        key={teleports}
        data-teleport-flash=""
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle, #fff 0%, #e0f2ff 60%, #9fd3ff 100%)',
          pointerEvents: 'none',
          opacity: 0,
          animation: `officexr-teleport-flash ${TELEPORT_FLASH_MS}ms ease-out`,
        }}
      />
    </>
  );
}
