import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PairTracker,
  tickProximity,
  tickSession,
  type Actions,
  type Bus,
  type RuleRegistry,
  type SnapshotHandshake,
  type Store,
  type SyncEngine,
  type Vec3,
} from '@officexr/sdk';
import { GhostController, NO_KEYS, type GhostKeys } from '../app/ghost-controller.ts';
import { resolveCharacterTunables } from '../characters/resolve.ts';
import { useApplication, useCatalog } from '../react/application-context.tsx';
import { ErrorBanner } from '../react/hud.tsx';
import { WorldLoadingScreen } from '../react/LoadingScreen.tsx';
import { PlayControlsProvider } from '../react/playControls.tsx';
import { NavGridProvider, useBuildNavGrid } from '../react/useNavGrid.ts';
import { usePlaySession, type PlayStorages } from '../react/usePlaySession.ts';
import { isTypingTarget } from '../react/useWorldFocus.ts';
import { createViewYaw, ViewYawProvider } from '../react/viewYaw.tsx';
import { useStoreWorldObjects } from '../renderer/useStoreWorldObjects.ts';
import { createGhostPlayControls } from './ghostPlayControls.ts';
import { drawMap, drawPlayers, type MapBox } from './topDownDraw.ts';
import { fitTransform, screenToWorld, unionBounds, type TopDownTransform } from './topDownGeometry.ts';

export interface TopDownPlayViewProps {
  store: Store;
  actions: Actions;
  rules: RuleRegistry;
  bus: Bus;
  sync: SyncEngine;
  handshake: SnapshotHandshake;
  selfId: string;
  mapName: string;
  /** Heads the loading screen, e.g. the office name. */
  title?: string;
  /** Changing this re-loads and re-applies `mapName`. */
  reloadKey?: number;
  storages: PlayStorages;
  /** Shown in place of a map-load error; dismissing it calls `onDismissError`. */
  error?: string | null;
  onDismissError?: () => void;
  onMapApplied?: (spawnPoints: readonly Vec3[]) => void;
  /** Overlays rendered above the canvas. */
  children?: React.ReactNode;
}

const KEY_BINDINGS: Record<string, keyof GhostKeys> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
};
/** Caps the step after a backgrounded tab resumes. */
const MAX_DT_SEC = 0.1;

/**
 * Plays a map on a Canvas2D top-down view, with no WebGL context: the
 * local player moves as a ghost and the session and proximity tick each frame.
 * Renders into the caller's positioned container.
 */
export function TopDownPlayView(props: TopDownPlayViewProps) {
  const { store, actions, rules, bus, sync, handshake, selfId } = props;
  const { geometry, catalog } = useApplication();
  const kinds = useCatalog();
  const session = usePlaySession({
    actions,
    mapName: props.mapName,
    storages: props.storages,
    reloadKey: props.reloadKey,
    onMapApplied: props.onMapApplied,
  });
  const footprint = session.buildingFootprint;
  const navGrid = useBuildNavGrid(store);
  // Yaw 0 faces -Z, which `GHOST_FORWARD` puts at the top of the view.
  const [viewYaw] = useState(createViewYaw);
  const [tracker] = useState(() => new PairTracker());
  const worldObjects = useStoreWorldObjects(store);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<TopDownTransform | null>(null);

  const controller = useMemo(
    () =>
      new GhostController(actions, store, selfId, footprint, () => {
        const s = store.getState();
        const { playerSpeed, charRadius } = resolveCharacterTunables(
          s.players[selfId]?.avatar.model ?? 'default',
          s.worldSettings,
          s.characterConfigs,
        );
        return { playerSpeed, charRadius, proximityRadius: s.worldSettings.proximityRadius };
      }),
    [actions, store, selfId, footprint],
  );
  const controls = useMemo(() => createGhostPlayControls(controller), [controller]);

  const boxes = useMemo<MapBox[]>(
    () =>
      worldObjects.instances.map((inst) => {
        const { min, max } = geometry.worldAABBOfInstance(inst);
        return {
          min: { x: min[0], z: min[2] },
          max: { x: max[0], z: max[2] },
          layout: catalog.getKind(inst.kindId)?.isLayoutObject === true };
      }),
    [worldObjects, geometry, catalog, kinds],
  );

  useEffect(() => {
    if (session.loaded) {
      sync.broadcastWorldState();
      sync.releaseSelf();
    }
  }, [session.loaded, sync]);

  useEffect(() => {
    const keys = { ...NO_KEYS };
    const onKey = (e: KeyboardEvent) => {
      const key = KEY_BINDINGS[e.code];
      if (!key || isTypingTarget(e.target)) {
        return;
      }
      e.preventDefault();
      keys[key] = e.type === 'keydown';
      controller.setKeys({ ...keys });
    };
    const onBlur = () => {
      Object.assign(keys, NO_KEYS);
      controller.setKeys(NO_KEYS);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [controller]);

  useEffect(() => {
    if (!session.loaded) {
      return;
    }
    const bounds = unionBounds([...footprint, ...boxes]);
    let prevState = store.getState();
    let last = performance.now();
    let frame = requestAnimationFrame(function loop(now) {
      frame = requestAnimationFrame(loop);
      const dtSec = Math.min(Math.max((now - last) / 1000, 0), MAX_DT_SEC);
      last = now;
      controller.step(dtSec);
      controls.refresh();
      prevState = tickSession({ actions, store, rules, bus, sync, handshake, prevState, nowMs: now });
      const state = store.getState();
      tickProximity(tracker, { players: state.players, selfId, bus, settings: state.worldSettings, nowMs: now, dtSec });

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || !bounds) {
        return;
      }
      // ponytail: draws at CSS-pixel resolution, so it is soft on high-DPI screens.
      const size = { width: canvas.clientWidth, height: canvas.clientHeight };
      if (canvas.width !== size.width || canvas.height !== size.height) {
        canvas.width = size.width;
        canvas.height = size.height;
      }
      const t = fitTransform(bounds, size);
      transformRef.current = t;
      drawMap(ctx, t, size, boxes, footprint);
      drawPlayers(ctx, t, state.players, selfId, {
        inner: state.worldSettings.proximityRadius,
        outer: state.worldSettings.proximityOuterRadius,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [session.loaded, store, actions, rules, bus, sync, handshake, selfId, controller, controls, tracker, boxes, footprint]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const t = transformRef.current;
    if (!t) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    controller.moveTo(screenToWorld(t, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        onClick={onClick}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
      />
      {props.error ? (
        <ErrorBanner message={props.error} onDismiss={() => props.onDismissError?.()} />
      ) : (
        session.error && <ErrorBanner message={session.error} onDismiss={session.dismissError} />
      )}
      <NavGridProvider value={navGrid}>
        <ViewYawProvider viewYaw={viewYaw}>
          <PlayControlsProvider controls={controls}>{props.children}</PlayControlsProvider>
        </ViewYawProvider>
      </NavGridProvider>
      {!session.ready && <WorldLoadingScreen title={props.title} step="Loading map…" />}
    </>
  );
}
