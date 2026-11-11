import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { XRStore } from '@react-three/xr';
import { useProgress } from '@react-three/drei';
import type { Actions, Bus, PlayerId, RuleRegistry, Store, SyncEngine, SnapshotHandshake, Vec3 } from '@officexr/sdk';
import type { BotPool } from '../bot/BotPool.ts';
import type { FrameStatsSample } from '../renderer/FrameStatsProbe.tsx';
import type { CameraMode } from '../renderer/config.ts';
import type { MotionLookState } from '../renderer/motionLook.ts';
import { Scene } from '../renderer/Scene.tsx';
import {
  ErrorBanner,
  FocusIndicator,
  SeatRefusalToast,
  TeleportFlash,
  TopLeftHud,
  WorldHud,
  type HudRealtime,
} from './hud.tsx';
import { WorldLoadingScreen, type WorldLoadingScreenProps } from './LoadingScreen.tsx';
import { useCameraMode } from './useCameraMode.ts';
import { useCoarsePointer } from './useCoarsePointer.ts';
import { NO_MOVE, type MoveInput } from '../renderer/moveIntent.ts';
import { VirtualJoystick } from './VirtualJoystick.tsx';
import { createViewYaw, ViewYawProvider } from './viewYaw.tsx';
import { usePlaySession, type PlayStorages } from './usePlaySession.ts';
import { useWorldConstants } from './useWorldConstants.ts';
import { useSlowNotice } from './useSlowNotice.ts';
import { useWorldFocus } from './useWorldFocus.ts';
import { NavGridProvider, useBuildNavGrid } from './useNavGrid.ts';
import { PlayControlsProvider } from './playControls.tsx';
import { useAutoWalk } from './useAutoWalk.ts';
import { playControlsOf, useSeating } from './useSeating.ts';
import { INITIAL_WORLD_READINESS, worldReadiness } from './world-readiness.ts';

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
  /** Heads the loading screen, e.g. the office name. */
  title?: string;
  /** Changing this re-loads and re-applies `mapName` without remounting the canvas. */
  reloadKey?: number;
  storages: PlayStorages;
  realtime: HudRealtime;
  /** Shown in place of a map-load error; dismissing it calls `onDismissError`. */
  error?: string | null;
  onDismissError?: () => void;
  onMapApplied?: (spawnPoints: readonly Vec3[]) => void;
  onFrameStats?: (sample: FrameStatsSample | null) => void;
  /** Makes the camera mode controlled; Alt+P then reports through `onCameraModeChange`. */
  cameraMode?: CameraMode;
  onCameraModeChange?: (mode: CameraMode) => void;
  /** Steers the view with device motion; absent means off. */
  motionLook?: MotionLookState;
  invertLook?: boolean;
  /** `'debug'` shows the camera, transport and layout status plus the focus chip; `'player'` shows none of it. */
  hud?: 'debug' | 'player';
  /** Lets the host start immersive XR sessions; see `createWorldXRStore`. */
  xrStore?: XRStore;
  /** Shows a ping bell when hovering another player's avatar in the fixed camera. */
  onPingPlayer?: (id: PlayerId) => void;
  /** Overlays rendered above the scene and HUD. */
  children?: React.ReactNode;
}

/**
 * Plays a map: loads it into the store, renders `<Scene>` once it has
 * landed, and overlays the HUD, focus chip and error banner. Until the
 * first map's models and floor colliders have loaded, a loading screen
 * covers everything and the self player is held out of the world.
 * Renders into the caller's positioned container.
 */
export function PlayView(props: PlayViewProps) {
  const cameraMode = useCameraMode({ value: props.cameraMode, onChange: props.onCameraModeChange });
  const worldFocused = useWorldFocus();
  const moveInputRef = useRef<MoveInput>(NO_MOVE);
  const coarsePointer = useCoarsePointer();
  const [viewYaw] = useState(createViewYaw);
  const worldConstants = useWorldConstants(props.store);
  const navGrid = useBuildNavGrid(props.store);
  const autoWalk = useAutoWalk(props.store, props.selfId, navGrid);
  const seating = useSeating(props.store, props.actions, props.selfId, autoWalk);
  const playControls = useMemo(() => playControlsOf(autoWalk, seating), [autoWalk, seating]);
  const session = usePlaySession({
    actions: props.actions,
    mapName: props.mapName,
    storages: props.storages,
    reloadKey: props.reloadKey,
    onMapApplied: props.onMapApplied,
  });
  const [readiness, dispatch] = useReducer(worldReadiness, INITIAL_WORLD_READINESS);
  const ready = readiness.type === 'ready';
  const slow = useSlowNotice(readiness.type === 'loading');

  useEffect(() => {
    if (session.loaded) {
      dispatch({ type: 'mapApplied', bakedLayouts: session.bakedLayouts });
    } else if (session.failed) {
      dispatch({ type: 'mapFailed', message: session.error ?? 'Could not load the map' });
    }
  }, [session.loaded, session.failed, session.bakedLayouts, session.error]);

  const { sync } = props;
  useEffect(() => {
    if (ready) {
      sync.releaseSelf();
    }
  }, [ready, sync]);

  return (
    <>
      {/* Not before the map lands: Scene broadcasts world state on mount. */}
      {session.loaded && (
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
          motionLook={props.motionLook}
          invertLook={props.invertLook}
          view={worldConstants}
          worldFocused={worldFocused}
          moveInputRef={moveInputRef}
          autoWalk={autoWalk}
          seating={seating}
          spawnPoints={session.spawnPoints}
          bakedLayouts={session.bakedLayouts}
          onFrameStats={props.onFrameStats}
          viewYaw={viewYaw}
          xrStore={props.xrStore}
          selfReady={ready}
          onPingPlayer={props.onPingPlayer}
          onModelsReady={() => dispatch({ type: 'modelsReady' })}
          onCollidersReady={(roomInstanceId) => dispatch({ type: 'collidersReady', roomInstanceId })}
          onCollidersError={(err) =>
            dispatch({ type: 'collidersFailed', message: `Could not load the world: ${err.message}` })
          }
        />
      )}
      {props.hud !== 'player' && (
        <TopLeftHud>
          <WorldHud cameraMode={cameraMode} realtime={props.realtime} bakedLayouts={session.bakedLayouts} />
          <FocusIndicator focused={worldFocused} />
        </TopLeftHud>
      )}
      <TeleportFlash seating={seating} />
      <SeatRefusalToast seating={seating} />
      {coarsePointer && <VirtualJoystick inputRef={moveInputRef} />}
      {props.error ? (
        <ErrorBanner message={props.error} onDismiss={() => props.onDismissError?.()} />
      ) : (
        session.error && <ErrorBanner message={session.error} onDismiss={session.dismissError} />
      )}
      <NavGridProvider value={navGrid}>
        <ViewYawProvider viewYaw={viewYaw}>
          <PlayControlsProvider controls={playControls}>{props.children}</PlayControlsProvider>
        </ViewYawProvider>
      </NavGridProvider>
      {!ready && (
        <LoadingScreenWithProgress
          title={props.title}
          step={session.loaded ? 'Loading world…' : 'Loading map…'}
          error={readiness.type === 'failed' ? readiness.message : undefined}
          slow={slow}
        />
      )}
    </>
  );
}

/** Subscribes to drei's load progress only while mounted, so the world doesn't re-render on later loads. */
function LoadingScreenWithProgress(props: WorldLoadingScreenProps) {
  const { progress } = useProgress();
  return <WorldLoadingScreen {...props} progress={props.error ? undefined : progress} />;
}
