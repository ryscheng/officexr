import React, { useCallback, useEffect, useState } from 'react';
import {
  createPersistentLocalState,
  type PersistentLocalState,
} from '@officexr/core-refactor';
import { Scene } from '@officexr/world/renderer';
import {
  ErrorBanner,
  FocusIndicator,
  useApplication,
  useCameraModeCycle,
  useWorldFocus,
  WorldHud,
} from '@officexr/world/react';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { WorldPanels } from '../../panels/world/WorldPanels.tsx';
import { useStudioSettings } from '../../panels/world/useStudioSettings.ts';
import { useStackSwitcher } from '../../realtime/useStackSwitcher.ts';
import { MapPickerPanel } from './MapPickerPanel.tsx';
import { useMapPicker } from './useMapPicker.ts';
import { publishFrameStats } from '../../perf/frame-stats.ts';

const SELF_ID = 'local-player';
const OFFICE_ID = 'studio-office';

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
  const cameraMode = useCameraModeCycle();
  const [local, setLocal] = useState<PersistentLocalState | null>(null);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

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
  const { geometry, catalog } = useApplication();
  const instanceAABB = useCallback(
    (
      position: readonly [number, number, number],
      kindId: string,
    ): { min: readonly [number, number, number]; max: readonly [number, number, number] } =>
      geometry.worldAABB(position, kindId),
    [geometry],
  );

  // Collider-shape override lookup from the catalog. Threaded into
  // useStackSwitcher → BotPool → BotPhysicsWorld so compound-step
  // staircase colliders in the bot's private Rapier world mirror what
  // MapColliders emits on the browser side (one source of truth for
  // staircase physics topology).
  const colliderShape = useCallback(
    (kindId: string) => catalog.getKind(kindId)?.colliderShape,
    [catalog],
  );

  const { stack, errorBanner, dismissError, onBotCountChange, onBotModeChange } =
    useStackSwitcher({ local, audio, instanceAABB, colliderShape });

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

  const { bakedLayoutName } = picker;
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
            onFrameStats={publishFrameStats}
          />
        )}
        <WorldHud
          cameraMode={cameraMode}
          realtime={stack?.mode ?? 'in-memory'}
          bakedLayoutName={bakedLayoutName}
        />
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
