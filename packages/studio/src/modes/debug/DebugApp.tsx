import React, { useEffect, useState } from 'react';
import { Scene, CAMERA_MODES, type CameraMode } from '@officexr/world/renderer';
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

  const { stack, errorBanner, dismissError, onBotCountChange, onBotModeChange } =
    useStackSwitcher({ local, audio });

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
          />
        )}
        <Hud cameraMode={cameraMode} mode={stack?.mode ?? 'in-memory'} />
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
              store={local?.store ?? null}
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
