import React, { useEffect, useRef, useState } from 'react';
import { Leva } from 'leva';
import { Scene } from './renderer/Scene.tsx';
import { SidePanel } from './ui/SidePanel.tsx';
import { CAMERA_MODES, type CameraMode } from './renderer/config.ts';
import {
  createPersistentLocalState,
  type PersistentLocalState,
} from './realtime/services.ts';
import { useStackSwitcher } from './realtime/useStackSwitcher.ts';

const SELF_ID = 'local-player';
const OFFICE_ID = 'debug-office';

type AppMode = 'in-memory' | 'ws';

export function DebugOfficePage() {
  const [cameraMode, setCameraMode] = useState<CameraMode>('fixed');
  const [local, setLocal] = useState<PersistentLocalState | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  // Alt+P cycles through camera modes.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        setCameraMode((current) => {
          const i = CAMERA_MODES.indexOf(current);
          return CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Bootstrap: build the persistent local-player bundle + audio
  // element once. The stack itself is owned by `useStackSwitcher`.
  useEffect(() => {
    const a = new Audio('/elevator-music.mp3');
    a.loop = true;
    a.volume = 0.4;
    audioRef.current = a;
    setAudio(a);

    const lp = createPersistentLocalState({
      selfId: SELF_ID,
      officeId: OFFICE_ID,
    });
    setLocal(lp);

    // Expose the store on window for ad-hoc inspection from the
    // browser console / a Playwright probe. Dev-only; harmless in
    // production but unnecessary.
    (window as unknown as { __OFFICE_STORE__: typeof lp.store }).__OFFICE_STORE__ = lp.store;
  }, []);

  const { stack, errorBanner, dismissError, onBotCountChange, onBotModeChange } =
    useStackSwitcher({ local, audio });

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      <main style={{ flex: 1, position: 'relative', minWidth: 0 }}>
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
            onBotCountChange={onBotCountChange}
            onBotModeChange={onBotModeChange}
          />
        )}
        <Hud cameraMode={cameraMode} mode={stack?.mode ?? 'in-memory'} />
        {errorBanner && (
          <ErrorBanner message={errorBanner} onDismiss={dismissError} />
        )}
      </main>
      <SidePanel>
        {/* Leva's `fill` mode embeds the panel inside its parent box
            (drops drag chrome, expands to 100% width/height). The
            existing `#leva__root` element is still mounted, so the
            `closest('#leva__root')` gating in SceneFrame continues to
            work for "user is typing in Leva — ignore WASD" checks. */}
        <Leva fill flat titleBar={{ drag: false }} />
      </SidePanel>
    </div>
  );
}

function Hud({ cameraMode, mode }: { cameraMode: CameraMode; mode: AppMode }) {
  return (
    <div
      style={{
        position: 'fixed',
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
        position: 'fixed',
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
