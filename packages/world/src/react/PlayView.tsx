import React from 'react';
import type { Actions, Bus, RuleRegistry, Store, SyncEngine, SnapshotHandshake, Vec3 } from '@officexr/sdk';
import type { BotPool } from '../bot/BotPool.ts';
import type { FrameStatsSample } from '../renderer/FrameStatsProbe.tsx';
import { Scene } from '../renderer/Scene.tsx';
import { ErrorBanner, FocusIndicator, WorldHud, type HudRealtime } from './hud.tsx';
import { useCameraModeCycle } from './useCameraModeCycle.ts';
import { usePlaySession, type PlayStorages } from './usePlaySession.ts';
import { useWorldConstants } from './useWorldConstants.ts';
import { useWorldFocus } from './useWorldFocus.ts';

export interface PlayViewProps {
  store: Store;
  actions: Actions;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  bots?: BotPool;
  selfId: string;
  mapName: string;
  /** Changing this re-loads and re-applies `mapName` without remounting the canvas. */
  reloadKey?: number;
  storages: PlayStorages;
  realtime: HudRealtime;
  /** Shown in place of a map-load error; dismissing it calls `onDismissError`. */
  error?: string | null;
  onDismissError?: () => void;
  onMapApplied?: (spawnPoints: readonly Vec3[]) => void;
  onFrameStats?: (sample: FrameStatsSample | null) => void;
  /** Overlays rendered above the scene and HUD. */
  children?: React.ReactNode;
}

/**
 * Plays a map: loads it into the store, renders `<Scene>` once it has
 * landed, and overlays the HUD, focus chip and error banner. Renders
 * into the caller's positioned container.
 */
export function PlayView(props: PlayViewProps) {
  const cameraMode = useCameraModeCycle();
  const worldFocused = useWorldFocus();
  const worldConstants = useWorldConstants(props.store);
  const session = usePlaySession({
    actions: props.actions,
    mapName: props.mapName,
    storages: props.storages,
    reloadKey: props.reloadKey,
    onMapApplied: props.onMapApplied,
  });

  return (
    <>
      {session.ready && (
        <Scene
          store={props.store}
          actions={props.actions}
          rules={props.rules}
          bus={props.bus}
          sync={props.sync}
          handshake={props.handshake}
          bots={props.bots}
          selfId={props.selfId}
          cameraMode={cameraMode}
          view={worldConstants}
          worldFocused={worldFocused}
          spawnPoints={session.spawnPoints}
          bakedLayoutPath={session.bakedLayoutPath}
          bakedLayoutName={session.bakedLayoutName}
          onFrameStats={props.onFrameStats}
        />
      )}
      <WorldHud cameraMode={cameraMode} realtime={props.realtime} bakedLayoutName={session.bakedLayoutName} />
      <FocusIndicator focused={worldFocused} />
      {props.error ? (
        <ErrorBanner message={props.error} onDismiss={() => props.onDismissError?.()} />
      ) : (
        session.error && <ErrorBanner message={session.error} onDismiss={session.dismissError} />
      )}
      {props.children}
    </>
  );
}
