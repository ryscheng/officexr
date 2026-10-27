import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createPersistentLocalState,
  type PersistentLocalState,
} from '@officexr/core-refactor';
import type { Vec3 } from '@officexr/sdk';
import { PlayView, useApplication, useWorldConstants } from '@officexr/world/react';
import {
  FilesystemLayoutStorage,
  FilesystemMapStorage,
  FilesystemRoomStorage,
  LocalStorageLayoutStorage,
  LocalStorageMapStorage,
  LocalStorageRoomStorage,
} from '@officexr/world/scenes';
import { SidePanel } from '../../ui/SidePanel.tsx';
import { SaveStatus, WorldPanels } from '../../panels/world/WorldPanels.tsx';
import { useStudioSettings } from '../../panels/world/useStudioSettings.ts';
import {
  isLoaded,
  useWorldConstantsPersistence,
} from '../../panels/world/useWorldConstantsPersistence.ts';
import { useStackSwitcher } from '../../realtime/useStackSwitcher.ts';
import { MapPickerPanel } from './MapPickerPanel.tsx';
import { useMapPicker } from './useMapPicker.ts';
import { publishFrameStats } from '../../perf/frame-stats.ts';

const SELF_ID = 'local-player';
const OFFICE_ID = 'studio-office';

function createStorages() {
  try {
    return {
      maps: new FilesystemMapStorage(),
      rooms: new FilesystemRoomStorage(),
      layouts: new FilesystemLayoutStorage(),
    };
  } catch {
    return {
      maps: new LocalStorageMapStorage(),
      rooms: new LocalStorageRoomStorage(),
      layouts: new LocalStorageLayoutStorage(),
    };
  }
}

/**
 * Debug application. Owns the full multiplayer SDK stack: persistent
 * local-player store, channel-stack switcher (in-memory ↔ ws), the
 * in-world `<PlayView>` from `@officexr/world` with all gameplay
 * fixtures, the bot pool, and the right-side Leva panel.
 *
 * Mounted only when the studio's mode is 'debug'. Scenes / Characters
 * editors are completely separate apps that don't share this stack.
 */
export function DebugApp() {
  const [local] = useState<PersistentLocalState>(() =>
    createPersistentLocalState({ selfId: SELF_ID, officeId: OFFICE_ID }),
  );
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    const a = new Audio('/elevator-music.mp3');
    a.loop = true;
    a.volume = 0.4;
    setAudio(a);
  }, []);

  useEffect(() => {
    (window as unknown as { __OFFICE_STORE__: typeof local.store }).__OFFICE_STORE__ =
      local.store;
  }, [local]);

  const worldConstants = useWorldConstants(local.store);
  const persistence = useWorldConstantsPersistence({
    store: local.store,
    actions: local.actions,
  });
  const constantsSettled = persistence.status.type !== 'loading';

  // Canonical AABB lookup from the application layer's geometry service.
  // Threaded into useStackSwitcher → BotPool → BotPhysicsWorld so the
  // bot's Rapier static colliders match the visible-mesh AABB of each
  // placed object (instead of the legacy one-voxel-cube collider that
  // let bots walk through 2 m blocks).
  const { geometry, catalog } = useApplication();
  const instanceAABB = geometry.worldAABB;

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

  const storages = useMemo(createStorages, []);
  const picker = useMapPicker(storages.maps);

  // Bots keep their bootstrap positions on the first map so none lands under
  // the player's spawn drop; WS-mode bots run in the Node CLI.
  const firstMapAppliedRef = useRef(false);
  const respawnBots = (spawnPoints: readonly Vec3[]) => {
    if (!firstMapAppliedRef.current) {
      firstMapAppliedRef.current = true;
      return;
    }
    if (stack?.mode === 'in-memory') {
      stack.bots.respawnAll(spawnPoints);
    }
  };

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
        {stack && constantsSettled && (
          <PlayView
            store={local.store}
            actions={local.actions}
            rules={local.rules}
            bus={local.bus}
            sync={stack.sync}
            handshake={stack.handshake}
            bots={stack.bots}
            selfId={SELF_ID}
            mapName={picker.selected}
            reloadKey={picker.resetCount}
            storages={storages}
            realtime={stack.mode}
            error={errorBanner}
            onDismissError={dismissError}
            onMapApplied={respawnBots}
            onFrameStats={publishFrameStats}
          />
        )}
      </main>
      <SidePanel>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ flex: '0 0 auto' }}>
            <MapPickerPanel picker={picker} />
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <SaveStatus status={persistence.status} onRetry={persistence.retry} />
            {isLoaded(persistence.status) && (
              <WorldPanels
                worldConstants={worldConstants}
                edit={persistence.edit}
                settings={studioSettings}
                onBotCountChange={onBotCountChange}
                onBotModeChange={onBotModeChange}
              />
            )}
          </div>
        </div>
      </SidePanel>
    </div>
  );
}
