import React, { useCallback, useEffect, useState } from 'react';
import { Scene, CAMERA_MODES, type CameraMode } from '@officexr/world/renderer';
import { useApplication } from '@officexr/world/react';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { WorldPanels } from '../../panels/world/WorldPanels.tsx';
import { useStudioSettings } from '../../panels/world/useStudioSettings.ts';
import {
  createPersistentLocalState,
  type PersistentLocalState,
} from '../../realtime/services.ts';
import { useStackSwitcher } from '../../realtime/useStackSwitcher.ts';
import { MapPickerPanel } from './MapPickerPanel.tsx';
import { useMapPicker } from './useMapPicker.ts';
import { useWorldFocus } from './useWorldFocus.ts';

const SELF_ID = 'local-player';
const OFFICE_ID = 'studio-office';

type AppMode = 'in-memory' | 'ws';

/**
 * Debug application. Owns the full multiplayer SDK stack: persistent
 * local-player store, channel-stack switcher (in-memory ↔ ws), the
 * in-world `<Scene>` from `@officexr/world` with all gameplay
 * fixtures, the bot pool, and the right-side Leva panel.
 *
 * Mounted only when the studio's mode is 'debug'. Scenes / Characters
 * editors are completely separate apps that don't share this stack.
 */
export function DebugApp() {
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const [local, setLocal] = useState<PersistentLocalState | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  // Alt+P cycles camera modes (excluding the editor-only 'top-down'
  // and 'free-fly' modes — those belong to the Scenes editor).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        setCameraMode((current) => {
          const cycleable: CameraMode[] = CAMERA_MODES.filter(
            (m) => m !== 'top-down' && m !== 'free-fly',
          );
          const i = cycleable.indexOf(current);
          const nextIdx = i === -1 ? 0 : (i + 1) % cycleable.length;
          return cycleable[nextIdx];
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const a = new Audio('/elevator-music.mp3');
    a.loop = true;
    a.volume = 0.4;
    setAudio(a);

    const lp = createPersistentLocalState({
      selfId: SELF_ID,
      officeId: OFFICE_ID,
    });
    setLocal(lp);

    (window as unknown as { __OFFICE_STORE__: typeof lp.store }).__OFFICE_STORE__ =
      lp.store;
  }, []);

  // Canonical AABB lookup from the application layer's geometry service.
  // Threaded into useStackSwitcher → BotPool → BotPhysicsWorld so the
  // bot's Rapier static colliders match the visible-mesh AABB of each
  // placed object (instead of the legacy one-voxel-cube collider that
  // let bots walk through 2 m blocks).
  const { geometry } = useApplication();
  const instanceAABB = useCallback(
    (
      position: readonly [number, number, number],
      kindId: string,
    ): { min: readonly [number, number, number]; max: readonly [number, number, number] } =>
      geometry.worldAABB(position, kindId),
    [geometry],
  );

  const { stack, errorBanner, dismissError, onBotCountChange, onBotModeChange } =
    useStackSwitcher({ local, audio, instanceAABB });

  // Expose the in-browser bot pool on window for the e2e regression
  // test. The deterministic visual test wants to silence bot
  // animations between snapshots so the only frame-to-frame
  // variation is the cube field. Production code never reads this.
  useEffect(() => {
    if (stack?.mode !== 'in-memory') return;
    (window as unknown as { __OFFICE_BOTS__?: typeof stack.bots }).__OFFICE_BOTS__ =
      stack.bots;
    return () => {
      delete (window as unknown as { __OFFICE_BOTS__?: unknown }).__OFFICE_BOTS__;
    };
  }, [stack]);

  // Headless Map-picker state. The paired MapPickerPanel below
  // consumes this to render the dropdown + buttons; the hook itself
  // owns the load/teleport/respawn side effects.
  const picker = useMapPicker({
    actions: local?.actions ?? null,
    bots: stack?.mode === 'in-memory' ? stack.bots : null,
  });

  // The renderer-tweaker bag. Studio owns the React state (persisted
  // to localStorage) and passes the current value into <Scene>; the
  // editing UI lives in <WorldPanels> rendered in the SidePanel
  // below.
  const studioSettings = useStudioSettings();

  // True iff the 3D canvas currently "owns" keyboard input. Clicking
  // anywhere inside a `[data-studio-panel]` ancestor (the
  // <SidePanel>) releases focus; clicking the canvas reclaims it.
  // The HUD's <FocusIndicator> below surfaces the state visually.
  const worldFocused = useWorldFocus();

  // Derive bakedLayoutName / bakedLayoutPath for the currently-loaded map.
  //
  // DebugApp loads a MapDocumentV1 which may compose multiple RoomInstances,
  // each potentially referencing a different RoomDocument.layoutName. <Scene>
  // accepts only a single bakedLayoutPath/bakedLayoutName pair — it is not a
  // per-instance compositor.
  //
  // Strategy: collect the distinct layoutNames from all rooms referenced by
  // the active map. When exactly one distinct layoutName is present (the common
  // case — one room, or all rooms share the same layout), pass it through to
  // <Scene> so BakedLayout + BakedLayoutColliders render the structural GLB and
  // its static Rapier colliders.
  //
  // When multiple distinct layoutNames are present, <Scene>'s single-layout
  // prop surface cannot express them. The correct multi-room solution is to
  // render per-instance <BakedLayout> siblings the way MapEditorCanvas does —
  // but DebugApp uses <Scene> as its R3F canvas root, not raw R3F content, so
  // that would require a new prop or a different composition boundary.
  // TODO: if multi-layout maps become a common runtime need, add a
  // `bakedLayouts?: Array<{path, name}>` prop to <Scene> and have it render
  // the collection; for now we log a warning and omit baked rendering so the
  // bug surface is visible rather than silently wrong.
  //
  // ISP note: the single-layout constraint lives in <Scene>'s prop interface,
  // not in DebugApp — the violation is documented there (Scene.tsx) and is an
  // intentional MVP scope boundary.
  const bakedLayoutName = (() => {
    const { mapDoc, rooms } = picker;
    if (!mapDoc) return undefined;
    const distinctLayouts = new Set<string>();
    for (const ri of mapDoc.rooms) {
      const room = rooms.get(ri.roomName);
      if (room?.layoutName) distinctLayouts.add(room.layoutName);
    }
    if (distinctLayouts.size === 1) return [...distinctLayouts][0];
    if (distinctLayouts.size > 1) {
      console.warn(
        '[DebugApp] Map has multiple distinct layoutNames across room instances; ' +
          'baked-layout rendering is not supported at the Scene level for multi-layout ' +
          'maps. Only voxel-object WorldObjects will render. Affected map:',
        mapDoc.name,
        [...distinctLayouts],
      );
    }
    return undefined;
  })();
  const bakedLayoutPath = bakedLayoutName
    ? `/api/baked-layouts/${encodeURIComponent(bakedLayoutName)}`
    : undefined;

  return (
    <div style={{ flex: 1, display: 'flex', minWidth: 0, minHeight: 0 }}>
      <main
        style={{
          flex: 1,
          position: 'relative',
          minWidth: 0,
          minHeight: 0,
          // The R3F Canvas inside computes its own size from this
          // container — without `overflow: hidden` it can briefly
          // expand past the flex track on first paint and shove the
          // header off-screen.
          overflow: 'hidden',
        }}
      >
        {stack && local && (
          <Scene
            store={local.store}
            actions={local.actions}
            rules={local.rules}
            bus={local.bus}
            sync={stack.sync}
            handshake={stack.handshake}
            bots={stack.bots}
            selfId={SELF_ID}
            cameraMode={cameraMode}
            viewConfig={studioSettings.viewConfig}
            worldFocused={worldFocused}
            spawnPoints={picker.spawnPoints}
            bakedLayoutPath={bakedLayoutPath}
            bakedLayoutName={bakedLayoutName}
          />
        )}
        <Hud cameraMode={cameraMode} mode={stack?.mode ?? 'in-memory'} />
        <FocusIndicator focused={worldFocused} />
        {errorBanner && (
          <ErrorBanner message={errorBanner} onDismiss={dismissError} />
        )}
      </main>
      <SidePanel>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: '0 0 auto' }}>
            <MapPickerPanel picker={picker} />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <WorldPanels
              settings={studioSettings}
              actions={local?.actions ?? null}
              onBotCountChange={onBotCountChange}
              onBotModeChange={onBotModeChange}
            />
          </div>
        </div>
      </SidePanel>
    </div>
  );
}

/**
 * Top-right chip showing whether the 3D canvas owns keyboard input.
 *   - Focused: green dot + "Controls active".
 *   - Blurred: amber dot + "Click world to control" prompt; the
 *     whole chip pulses gently so it draws the eye when the user
 *     starts typing and nothing happens.
 *
 * The chip itself is pointer-events: none so clicking ON it doesn't
 * register as a "focus the world" mousedown — the user has to click
 * the canvas behind it.
 */
function FocusIndicator({ focused }: { focused: boolean }) {
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
          boxShadow: focused
            ? '0 0 6px #22c55e'
            : '0 0 6px #fbbf24',
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

function Hud({ cameraMode, mode }: { cameraMode: CameraMode; mode: AppMode }) {
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
      {`Camera: ${cameraMode} (Alt+P to cycle) · Realtime: ${mode}
WASD to move · Click to look · Esc to release mouse`}
    </div>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
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
