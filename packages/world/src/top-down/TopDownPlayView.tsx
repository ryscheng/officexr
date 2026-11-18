import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PairTracker,
  tickProximity,
  tickSession,
  type Actions,
  type Bus,
  type RuleRegistry,
  type OfficeState,
  type PlayerId,
  type PlayerState,
  type SnapshotHandshake,
  type Store,
  type SyncEngine,
  type Vec3,
  loginOf,
} from '@officexr/sdk';
import { GhostController, NO_KEYS, type GhostKeys } from '../app/ghost-controller.ts';
import { resolveCharacterTunables } from '../characters/resolve.ts';
import { useApplication, useCatalog } from '../react/application-context.tsx';
import { ErrorBanner } from '../react/hud.tsx';
import { WorldLoadingScreen } from '../react/LoadingScreen.tsx';
import { PlayControlsProvider } from '../react/playControls.tsx';
import { NavGridProvider, useBuildNavGrid } from '../react/useNavGrid.ts';
import { usePlaySession, type PlayStorages } from '../react/usePlaySession.ts';
import { hasCommandModifier, isTypingTarget, useWorldFocus } from '../react/useWorldFocus.ts';
import { PingBellButton } from '../react/PingBellButton.tsx';
import { useStoreSelector } from '../react/useStoreSelector.ts';
import { createViewYaw, ViewYawProvider } from '../react/viewYaw.tsx';
import { useStoreWorldObjects } from '../renderer/useStoreWorldObjects.ts';
import { CameraControlsProvider, TopDownCameraController } from './cameraControls.tsx';
import { createGhostPlayControls } from './ghostPlayControls.ts';
import { cameraTransform, zoomLimits } from './topDownCamera.ts';
import { characterHeight } from './topDownCharacter.ts';
import { drawFrame, type DeskLabel } from './topDownDraw.ts';
import { playerAt, screenToWorld, unionBounds, worldToScreen, type ScreenPoint, type TopDownTransform, type XZBounds } from './topDownGeometry.ts';
import { PlayerMotion } from './topDownMotion.ts';
import { buildScene, type ResolveInstance, type TopDownScene } from './topDownScene.ts';
import { useCanvasGestures, type CanvasGestureHandlers } from './useCanvasGestures.ts';

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
  onMapApplied?: (spawnPoints: readonly Vec3[]) => void;
  /** Pings another player; the 2D view shows a bell over a hovered player. Touch users ping from the web client's participant list. */
  onPingPlayer?: (id: PlayerId) => void;
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
/** Zoom hotkeys, by `KeyboardEvent.key` so they follow the keyboard layout. */
const ZOOM_KEYS: Record<string, 'in' | 'out' | 'recentre'> = { '+': 'in', '=': 'in', '-': 'out', _: 'out', '0': 'recentre' };
/** Caps the step after a backgrounded tab resumes. */
const MAX_DT_SEC = 0.1;
/** Half-size of the area shown around players when the map has nothing to fit to. */
const EMPTY_MAP_MARGIN_M = 5;
/** Sharpness is capped here: beyond 2× the canvas costs more than it shows. */
const MAX_PIXEL_RATIO = 2;

const selectPlayers = (s: OfficeState) => s.players;

/** Where a hovered character's ping bell sits: beside its head, clear of the name tag. */
function bellPosition(t: TopDownTransform, pos: Vec3): ScreenPoint {
  const c = worldToScreen(t, pos);
  const h = characterHeight(t.scale);
  return { x: c.x + h * 0.35, y: c.y - h * 0.85 };
}

function HoverBell({ store, id, transformRef, bellRef, onPing, onLeave }: {
  store: Store;
  id: PlayerId;
  bellRef: React.RefObject<HTMLDivElement | null>;
  transformRef: React.RefObject<TopDownTransform | null>;
  onPing: (id: PlayerId) => void;
  onLeave: () => void;
}) {
  const player = useStoreSelector(store, selectPlayers)[id];
  useEffect(() => {
    if (!player) {
      onLeave();
    }
  }, [player, onLeave]);
  const t = transformRef.current;
  if (!player || !t) {
    return null;
  }
  const at = bellPosition(t, player.pos);
  // ponytail: the bell follows a player who walks away under a stationary pointer until the next mousemove.
  return (
    <div ref={bellRef} onMouseLeave={onLeave} style={{ position: 'absolute', left: at.x, top: at.y }}>
      <PingBellButton name={player.name} onPing={() => onPing(id)} />
    </div>
  );
}

function playerBounds(players: Readonly<Record<string, PlayerState>>): XZBounds | null {
  return unionBounds(
    Object.values(players).map(({ pos }) => ({
      min: { x: pos.x - EMPTY_MAP_MARGIN_M, z: pos.z - EMPTY_MAP_MARGIN_M },
      max: { x: pos.x + EMPTY_MAP_MARGIN_M, z: pos.z + EMPTY_MAP_MARGIN_M },
    })),
  );
}

/** The non-self player whose character is under `point`, or null. Characters stand above their feet, so the hit circle does too. */
function characterAt(point: ScreenPoint, players: Readonly<Record<string, PlayerState>>, t: TopDownTransform, selfId: string): PlayerId | null {
  const h = characterHeight(t.scale);
  return playerAt({ x: point.x, y: point.y + h * 0.45 }, players, t, selfId, h * 0.5);
}

/** Claimed desks, named after their owner (online name, else the login's local part). */
function deskLabels(state: OfficeState): DeskLabel[] {
  const names = new Map(Object.values(state.players).map((p) => [loginOf(p.id), p.name]));
  return state.deskAreas.flatMap((area) => {
    const login = state.deskClaims[area.id];
    return login ? [{ min: area.min, max: area.max, owner: names.get(login) || login.split('@')[0] }] : [];
  });
}

/**
 * Plays a map on a Canvas2D top-down view, with no WebGL context: the local player moves
 * as a ghost, the camera follows them (zoom with the wheel, a pinch, +/− or the HUD; drag to
 * look around) and the session and proximity tick each frame. Renders into the caller's
 * positioned container.
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
  const [camera] = useState(() => new TopDownCameraController());
  const [motion] = useState(() => new PlayerMotion());
  const worldObjects = useStoreWorldObjects(store);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<TopDownTransform | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<PlayerId | null>(null);

  // The footprint changes per applied map; `setFootprint` keeps held keys and a go-to intent.
  const [controller] = useState(
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
  );
  const [controls] = useState(() => createGhostPlayControls(controller));
  const prevStateRef = useRef<OfficeState | null>(null);
  // Not an O3 mirror pair: React state stays the source of truth and this ref is written one way,
  // from the effect below, for the requestAnimationFrame loop to read without restarting each time
  // the scene or the hovered player changes. A store would need its own subscription in the loop
  // for no gain, since the loop already re-reads every frame.
  const drawInputsRef = useRef<{ scene: TopDownScene | null; hoveredId: PlayerId | null }>({ scene: null, hoveredId: null });

  const scene = useMemo(() => {
    const resolve: ResolveInstance = (inst) => {
      const { min, max } = geometry.worldAABBOfInstance(inst);
      // An unknown kind (catalog still loading) still draws, as a plain block.
      const kind = catalog.getKind(inst.kindId) ?? { id: inst.kindId, label: inst.kindId, category: 'prop' as const, isLayoutObject: false };
      return { kind, aabb: { min, max } };
    };
    return buildScene(worldObjects.instances, resolve, footprint);
    // `kinds` changes when the catalog loads, which changes what `catalog.getKind` returns.
  }, [worldObjects, geometry, catalog, kinds, footprint]);

  useEffect(() => {
    controller.setFootprint(footprint);
  }, [controller, footprint]);

  useEffect(() => {
    drawInputsRef.current = { scene, hoveredId };
  }, [scene, hoveredId]);

  useEffect(() => {
    if (session.loaded) {
      sync.broadcastWorldState();
      sync.releaseSelf();
    }
  }, [session.loaded, sync]);

  const worldFocused = useWorldFocus();
  useEffect(() => {
    if (!worldFocused) {
      controller.setKeys(NO_KEYS);
      return;
    }
    const keys = { ...NO_KEYS };
    const onKey = (e: KeyboardEvent) => {
      const typing = e.type === 'keydown' && (isTypingTarget(e.target) || hasCommandModifier(e));
      const zoom = e.type === 'keydown' ? ZOOM_KEYS[e.key] : undefined;
      if (zoom && !typing) {
        e.preventDefault();
        if (zoom === 'in') {
          camera.zoomIn();
        } else if (zoom === 'out') {
          camera.zoomOut();
        } else {
          camera.recentre();
        }
        return;
      }
      const key = KEY_BINDINGS[e.code];
      // Only keydown is filtered, so a key released inside a text field or with a modifier can't stay held.
      if (!key || typing) {
        return;
      }
      e.preventDefault();
      keys[key] = e.type === 'keydown';
      if (keys[key]) {
        // Walking brings the camera back to you after a look around.
        camera.recentre();
      }
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
  }, [controller, camera, worldFocused]);

  useEffect(() => {
    if (!session.loaded) {
      return;
    }
    let last = performance.now();
    let frame = requestAnimationFrame(function loop(now) {
      frame = requestAnimationFrame(loop);
      const dtSec = Math.min(Math.max((now - last) / 1000, 0), MAX_DT_SEC);
      last = now;
      controller.step(dtSec);
      controls.refresh();
      prevStateRef.current = tickSession({
        actions,
        store,
        rules,
        bus,
        sync,
        handshake,
        prevState: prevStateRef.current ?? store.getState(),
        nowMs: now,
      });
      const state = store.getState();
      tickProximity(tracker, { players: state.players, voiceZones: state.voiceZones, selfId, bus, settings: state.worldSettings, nowMs: now, dtSec });
      motion.update(state.players, dtSec);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const { scene, hoveredId } = drawInputsRef.current;
      const bounds = scene?.bounds ?? playerBounds(state.players);
      if (!canvas || !ctx || !scene || !bounds) {
        return;
      }
      const size = { width: canvas.clientWidth, height: canvas.clientHeight };
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const backing = { width: Math.round(size.width * ratio), height: Math.round(size.height * ratio) };
      if (canvas.width !== backing.width || canvas.height !== backing.height) {
        canvas.width = backing.width;
        canvas.height = backing.height;
      }
      // Draw in CSS pixels; the backing store supplies the sharpness.
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      camera.setViewport(zoomLimits(bounds, size), size);
      const self = state.players[selfId];
      if (self) {
        camera.track(self.pos, dtSec);
      }
      const t = cameraTransform(camera.state, size);
      transformRef.current = t;
      const deskIds = new Set(state.deskAreas.map((a) => a.id));
      drawFrame(ctx, {
        t,
        size,
        timeSec: now / 1000,
        scene,
        zones: state.voiceZones.filter((z) => !deskIds.has(z.id)),
        desks: deskLabels(state),
        players: state.players,
        motion: (id) => motion.sample(id),
        selfId,
        hoveredId,
        rings: { inner: state.worldSettings.proximityRadius, outer: state.worldSettings.proximityOuterRadius },
        destination: controller.destination(),
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [session.loaded, store, actions, rules, bus, sync, handshake, selfId, controller, controls, tracker, camera, motion]);

  const onPingPlayer = props.onPingPlayer;
  const gestures = useMemo<CanvasGestureHandlers>(
    () => ({
      onTap(point) {
        const t = transformRef.current;
        if (t) {
          camera.recentre();
          controller.moveTo(screenToWorld(t, point));
        }
      },
      onHover(point, relatedTarget) {
        const t = transformRef.current;
        if (!onPingPlayer || !t) {
          return;
        }
        if (point) {
          setHoveredId(characterAt(point, store.getState().players, t, selfId));
        } else if (!(relatedTarget instanceof Node && bellRef.current?.contains(relatedTarget))) {
          setHoveredId(null);
        }
      },
      onPan(dx, dy) {
        camera.pan(dx, dy, drawInputsRef.current.scene?.bounds ?? null);
      },
      onZoom(factor, anchor) {
        camera.zoom(factor, anchor);
      },
    }),
    [camera, controller, store, selfId, onPingPlayer],
  );
  const canvasProps = useCanvasGestures(canvasRef, gestures);
  const clearHover = useCallback(() => setHoveredId(null), []);

  return (
    <>
      <canvas
        ref={canvasRef}
        {...canvasProps}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: hoveredId ? 'pointer' : 'default' }}
      />
      {onPingPlayer && hoveredId && (
        <HoverBell
          store={store}
          id={hoveredId}
          transformRef={transformRef}
          bellRef={bellRef}
          onPing={onPingPlayer}
          onLeave={clearHover}
        />
      )}
      {session.error && <ErrorBanner message={session.error} onDismiss={session.dismissError} />}
      <NavGridProvider value={navGrid}>
        <ViewYawProvider viewYaw={viewYaw}>
          <CameraControlsProvider controls={camera}>
            <PlayControlsProvider controls={controls}>{props.children}</PlayControlsProvider>
          </CameraControlsProvider>
        </ViewYawProvider>
      </NavGridProvider>
      {!session.ready && <WorldLoadingScreen title={props.title} step="Loading map…" />}
    </>
  );
}
