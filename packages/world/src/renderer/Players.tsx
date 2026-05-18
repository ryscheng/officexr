import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  RigidBody,
  BallCollider,
  type RapierRigidBody,
  type RapierCollider,
  type CollisionEnterPayload,
  type IntersectionEnterPayload,
  type IntersectionExitPayload,
} from '@react-three/rapier';
import { ActiveCollisionTypes } from '@dimforge/rapier3d-compat';
import type { Bus, OfficeState, Store } from '@officexr/sdk';
import { Adventurer } from './Adventurer.tsx';
import { CHARACTERS, type CameraMode, type CharacterName } from './config.ts';
import { resolveCharacterTunables } from '../characters/resolve.ts';
import {
  BODY_GROUPS,
  INNER_SENSOR_GROUPS,
  OUTER_SENSOR_GROUPS,
  type ColliderTag,
} from '../physics/groups.ts';
import { routeContactEvent } from '../physics/bridge.ts';

interface PlayersProps {
  store: Store;
  bus: Bus;
  selfId: string;
  cameraMode: CameraMode;
  /** Mutated each frame so the camera rig reads the latest local position. */
  selfPosRef: React.MutableRefObject<THREE.Vector3>;
  /** Set when the self player's RigidBody mounts so SceneFrame can drive it
   * via a KinematicCharacterController. */
  selfBodyRef: React.MutableRefObject<RapierRigidBody | null>;
  /** When true, every character is rendered at its bind pose with no
   * animation mixer activity (no idle clip, no bump reactions, no
   * timeScale updates). Used by the Mugshot mode to produce a
   * deterministic frame for snapshot testing. */
  paused?: boolean;
  /** Ref mutated each frame by SceneFrame to reflect local player airborne
   * state. Used to override motion to 'jumping' for the self avatar without
   * a React re-render. Ref is created in Scene.tsx and threaded to both
   * SceneFrame and Players. */
  isAirborneRef: React.MutableRefObject<boolean>;
}

interface BumpState {
  /** ms since unix-epoch-ish timestamp when the bump was registered. */
  startMs: number;
  /** Push direction (away from the other character). */
  normal: { x: number; z: number };
}

/** What animation tier a character is currently in. Derived per-frame from
 * |player.vel| against the broadcast walk and run speeds. */
type MotionState = 'idle' | 'walking' | 'running' | 'jumping';

/** Offset added to player.yaw when rotating the avatar — adjust if the GLB's
 * default facing differs from -Z. KayKit Adventurers point at +Z by default. */
const AVATAR_YAW_OFFSET = Math.PI;

/** Cap on extrapolation time (s). If updates stop arriving, the projected
 * position freezes here instead of running away with stale velocity. */
const EXTRAPOLATION_CAP_S = 0.1;

/**
 * Compute the rendered XYZ for a player, extrapolated from the last received
 * position using the broadcast velocity. For the local player (tRecv === undefined)
 * this is a no-op — the local store is updated every frame, so pos is fresh.
 */
export function extrapolatePos(
  player: { pos: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number }; tRecv?: number },
  nowMs: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  if (player.tRecv === undefined) {
    out.set(player.pos.x, player.pos.y, player.pos.z);
    return out;
  }
  const elapsed = Math.min(EXTRAPOLATION_CAP_S, (nowMs - player.tRecv) / 1000);
  out.set(
    player.pos.x + player.vel.x * elapsed,
    player.pos.y + player.vel.y * elapsed,
    player.pos.z + player.vel.z * elapsed,
  );
  return out;
}

interface PlayerEntry {
  id: string;
  character: CharacterName;
}

const WALK_THRESHOLD = 0.05;

function pickCharacter(): CharacterName {
  return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
}

/** Use `state.players[id].avatar.model` as the rendered character if
 * it's a valid `CharacterName` (e.g. Mugshot mode sets it explicitly);
 * otherwise pick at random. Lets a caller deterministically force a
 * specific character without us having to thread a new prop through. */
function pickCharacterForPlayer(
  state: OfficeState,
  id: string,
): CharacterName {
  const model = state.players[id]?.avatar.model;
  if (model && (CHARACTERS as readonly string[]).includes(model)) {
    return model as CharacterName;
  }
  return pickCharacter();
}

/** Rotate `from` toward `to` by at most `maxStep` radians along the shortest arc. */
function stepTowardAngle(from: number, to: number, maxStep: number): number {
  let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= maxStep) return to;
  return from + Math.sign(delta) * maxStep;
}

/**
 * Renders one Adventurer per player, each wrapped in a Rapier
 * `RigidBody` (kinematic-position) with three colliders: a body ball
 * for character-vs-character + character-vs-wall, and two sensor
 * balls for the inner/outer proximity rings. Peer rigid bodies are
 * driven each frame from the store (`setNextKinematicTranslation`);
 * the SELF rigid body is driven by the `KinematicCharacterController`
 * in SceneFrame via `selfBodyRef`.
 *
 * Visual offsets (bump easing, smooth yaw turn) are applied to an
 * inner `<group>` that's a CHILD of the rigid body — so they don't
 * displace the physics body / sensors, only the rendered avatar.
 */
export function Players({
  store,
  bus,
  selfId,
  cameraMode,
  selfPosRef,
  selfBodyRef,
  paused,
  isAirborneRef,
}: PlayersProps) {
  // Read movement/animation params from the broadcast world state. Any peer
  // (the local player here) that calls actions.setWorldSettings updates the
  // store; the SyncEngine keeps it in sync across clients.
  const [worldSettings, setWorldSettings] = useState(
    () => store.getState().worldSettings,
  );
  useEffect(() => {
    return store.subscribe(
      (s) => s.worldSettings,
      (next) => setWorldSettings(next),
    );
  }, [store]);
  const {
    idleAnimSpeed,
    walkAnimSpeed,
    runAnimSpeed,
    turnSpeed,
    playerSpeed,
    runSpeedMultiplier,
    charRadius,
    proximityRadius,
    proximityOuterRadius,
  } = worldSettings;
  const runSpeed = playerSpeed * runSpeedMultiplier;
  const initialState = useMemo(() => store.getState(), [store]);
  const [players, setPlayers] = useState<PlayerEntry[]>(() =>
    Object.keys(initialState.players).map((id) => ({
      id,
      character: pickCharacterForPlayer(initialState, id),
    })),
  );

  // Subscribe to player-id set changes only (not positions).
  useEffect(() => {
    const unsubscribe = store.subscribeAll(
      (next: OfficeState, prev: OfficeState) => {
        const nextIds = Object.keys(next.players);
        const prevIds = Object.keys(prev.players);
        if (
          nextIds.length === prevIds.length &&
          nextIds.every((id, i) => id === prevIds[i])
        ) {
          return;
        }
        setPlayers((current) => {
          const byId = new Map(current.map((p) => [p.id, p]));
          return nextIds.map(
            (id) =>
              byId.get(id) ?? { id, character: pickCharacterForPlayer(next, id) },
          );
        });
      },
    );
    return unsubscribe;
  }, [store]);

  // Per-player rigid body refs — peers driven from store each frame; self is
  // wired through `selfBodyRef` and driven by the character controller.
  const bodyRefs = useRef<Map<string, RapierRigidBody>>(new Map());
  // Map from Rapier collider handle → ColliderTag. Rapier's `Collider`
  // type doesn't have a `userData` slot we can set, so we keep the
  // body/sensor labels here and look them up by handle inside the
  // collision-event handlers.
  const tagByHandle = useRef<Map<number, ColliderTag>>(new Map());
  // Inner <group> per player — visual yaw + bump offset live here.
  const groupRefs = useRef<Map<string, THREE.Group>>(new Map());
  const motionState = useRef<Map<string, MotionState>>(new Map());
  const currentYaw = useRef<Map<string, number>>(new Map());
  const [motionByPlayer, setMotionByPlayer] = useState<
    Record<string, MotionState>
  >({});
  const [animScaleByPlayer, setAnimScaleByPlayer] = useState<
    Record<string, number>
  >({});
  const animScaleQuant = useRef<Map<string, number>>(new Map());

  const bumps = useRef<Map<string, BumpState>>(new Map());
  const [bumpCounters, setBumpCounters] = useState<Record<string, number>>(
    {},
  );
  useEffect(() => {
    return bus.on('collision:char-bump', (evt) => {
      bumps.current.set(evt.selfId, {
        startMs: performance.now(),
        normal: evt.normal,
      });
      setBumpCounters((prev) => ({
        ...prev,
        [evt.selfId]: (prev[evt.selfId] ?? 0) + 1,
      }));
    });
  }, [bus]);

  const tmpVec = useMemo(() => new THREE.Vector3(), []);

  // --- Rapier → bus event bridge -----------------------------------
  //
  // The body/sensor colliders on every player carry `userData`
  // tagging them as 'body' / 'inner-sensor' / 'outer-sensor' plus the
  // owning playerId. Rapier fires onCollisionEnter and
  // onIntersectionEnter/Exit handlers with both sides of the pair —
  // we route them through `routeContactEvent` to emit the SDK bus
  // events (`proximity:*`, `collision:char-bump`) that the rest of
  // the app already consumes.
  const lookupTag = (c: RapierCollider | null | undefined): ColliderTag | null =>
    c ? tagByHandle.current.get(c.handle) ?? null : null;

  const handleCollisionEnter = useMemo(
    () => (payload: CollisionEnterPayload) => {
      const a = lookupTag(payload.target.collider);
      const b = lookupTag(payload.other.collider);
      if (!a || !b) return;
      // The first manifold's normal points from `other` to `target`,
      // so we pass it as the A→B normal for the bridge.
      let normal: { x: number; z: number } | undefined;
      const m = payload.manifold;
      if (m) {
        const n = m.normal();
        normal = { x: n.x, z: n.z };
      }
      routeContactEvent(bus.emit, selfId, a, b, true, normal);
    },
    // lookupTag closes over the ref so it's stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bus, selfId],
  );
  const handleIntersectionEnter = useMemo(
    () => (payload: IntersectionEnterPayload) => {
      const a = lookupTag(payload.target.collider);
      const b = lookupTag(payload.other.collider);
      if (!a || !b) return;
      routeContactEvent(bus.emit, selfId, a, b, true);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bus, selfId],
  );
  const handleIntersectionExit = useMemo(
    () => (payload: IntersectionExitPayload) => {
      const a = lookupTag(payload.target.collider);
      const b = lookupTag(payload.other.collider);
      if (!a || !b) return;
      routeContactEvent(bus.emit, selfId, a, b, false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bus, selfId],
  );

  useFrame((_, dt) => {
    const state = store.getState();
    const now = performance.now();
    let motionChanged = false;
    const nextMotion: Record<string, MotionState> = {};
    let animScaleChanged = false;
    const nextAnimScales: Record<string, number> = {};
    const runThreshold = (playerSpeed + runSpeed) / 2;
    const WALK_ENTER_SQ = (WALK_THRESHOLD * 1.5) * (WALK_THRESHOLD * 1.5);
    const WALK_EXIT_SQ = WALK_THRESHOLD * WALK_THRESHOLD;
    const RUN_ENTER_SQ = (runThreshold * 1.05) * (runThreshold * 1.05);
    const RUN_EXIT_SQ = (runThreshold * 0.95) * (runThreshold * 0.95);

    for (const [id, player] of Object.entries(state.players)) {
      const grp = groupRefs.current.get(id);
      const body = bodyRefs.current.get(id);
      if (!grp || !body) continue;

      // Extrapolate non-self players forward by their broadcast velocity to
      // smooth between rate-limited network updates (30 Hz broadcast →
      // 60 Hz render).
      const renderPos = extrapolatePos(player, now, tmpVec);

      // Drive peer rigid bodies from the store. The SELF rigid body is
      // driven elsewhere by the character controller — skip it here so
      // we don't fight the controller for the body's position. The
      // rigid body origin sits at the character's *foot* position (y=0
      // matches the broadcast `pos`); the ball colliders are lifted to
      // torso height in local space below.
      if (id !== selfId) {
        body.setNextKinematicTranslation({
          x: renderPos.x,
          y: renderPos.y,
          z: renderPos.z,
        });
      }

      // Bump easing — visual-only offset on the inner group.
      const bump = bumps.current.get(id);
      let bumpX = 0;
      let bumpZ = 0;
      if (bump) {
        const elapsed = now - bump.startMs;
        const dur = worldSettings.bumpEasingMs;
        if (elapsed >= dur) {
          bumps.current.delete(id);
        } else {
          const t = elapsed / dur;
          const decay = Math.exp(-3.2 * t);
          const wave = Math.cos(2 * Math.PI * 1.1 * t);
          const env = decay * wave;
          const kick = 0.16;
          bumpX = bump.normal.x * env * kick;
          bumpZ = bump.normal.z * env * kick;
        }
      }
      // Inner group is positioned RELATIVE to the rigid body. Its
      // STATIC y-offset is `BODY_Y - charRadius` — the wrapper's
      // local y=0 plane must coincide with the ball collider's
      // bottom, which is where the kinematic-character controller
      // settles contacts (NOT the rigid body root). Without this
      // term the wrapper rides at body root y, and the mesh anchor
      // (which expects local y=0 to be at the standing surface)
      // renders the character sunk by `BODY_Y - charRadius` below
      // the cube top. Bump is x/z only.
      grp.position.set(bumpX, BODY_Y - charRadius, bumpZ);

      const targetYaw = (player.yaw ?? 0) + AVATAR_YAW_OFFSET;
      const prev = currentYaw.current.get(id) ?? targetYaw;
      grp.rotation.y = stepTowardAngle(prev, targetYaw, turnSpeed * dt);
      currentYaw.current.set(id, grp.rotation.y);

      const v = player.vel;
      const speedSq = v.x * v.x + v.z * v.z;
      const previous = motionState.current.get(id) ?? 'idle';
      let motion: MotionState = previous;
      if (previous === 'idle') {
        if (speedSq >= RUN_ENTER_SQ) motion = 'running';
        else if (speedSq >= WALK_ENTER_SQ) motion = 'walking';
      } else if (previous === 'walking') {
        if (speedSq >= RUN_ENTER_SQ) motion = 'running';
        else if (speedSq <= WALK_EXIT_SQ) motion = 'idle';
      } else {
        if (speedSq <= WALK_EXIT_SQ) motion = 'idle';
        else if (speedSq <= RUN_EXIT_SQ) motion = 'walking';
      }
      // Airborne override: if the player is in the air, force 'jumping'
      // regardless of horizontal speed. Driven by isAirborneRef for the
      // local player (frame-accurate, no re-render overhead); by
      // player.isAirborne for peers (broadcast once per state change via
      // presence:position).
      const playerIsAirborne =
        id === selfId
          ? isAirborneRef.current
          : (state.players[id]?.isAirborne ?? false);

      if (playerIsAirborne) {
        motion = 'jumping';
      }

      nextMotion[id] = motion;
      if (previous !== motion) {
        motionState.current.set(id, motion);
        motionChanged = true;
      }

      const speed = Math.sqrt(speedSq);
      const denom = motion === 'running' ? runSpeed : playerSpeed;
      const ratio = denom > 0 ? speed / denom : 0;
      const quantised = Math.round(Math.max(0, Math.min(1, ratio)) * 10) / 10;
      if (animScaleQuant.current.get(id) !== quantised) {
        animScaleQuant.current.set(id, quantised);
        animScaleChanged = true;
      }
      nextAnimScales[id] = quantised;

      if (id === selfId) {
        selfPosRef.current.copy(renderPos);
      }
    }

    if (motionChanged) setMotionByPlayer(nextMotion);
    if (animScaleChanged) setAnimScaleByPlayer(nextAnimScales);
  });

  // The body collider centre is at the rigid-body origin, lifted ~0.9 m so
  // the ball is roughly torso-height. Sensors share that centre.
  const BODY_Y = 0.9;

  // Every character body in this scene is a kinematic-position rigid
  // body. Rapier's default `ActiveCollisionTypes.DEFAULT` only enables
  // contact / intersection detection between (dynamic↔dynamic,
  // dynamic↔kinematic, dynamic↔fixed) pairs — it deliberately
  // EXCLUDES kinematic↔kinematic. So with the defaults, two
  // characters never generate intersection events for each other (no
  // proximity glow, no body-vs-body bump). `ALL` enables every pair
  // type so our kinematic-vs-kinematic body↔sensor and
  // body↔body intersections actually fire.
  const ACTIVE_TYPES = ActiveCollisionTypes.ALL;

  return (
    <>
      {players.map((p) => {
        const isSelf = p.id === selfId;
        const bodyTag: ColliderTag = { kind: 'body', ownerId: p.id };
        const innerTag: ColliderTag = { kind: 'inner-sensor', ownerId: p.id };
        const outerTag: ColliderTag = { kind: 'outer-sensor', ownerId: p.id };
        // Seed the rigid body at the player's *current* broadcast
        // position, not the React/Three default of (0,0,0). Without
        // this, every RB spawns at the origin and every body/sensor
        // pair overlaps for one frame before `setNextKinematicTranslation`
        // teleports them to their broadcast positions. Rapier
        // dutifully fires `started=true` for every pair on frame 1
        // (every peer "entered" the local player's proximity ring), so
        // the ProximityGlow lights up every disc; on frame 2 four
        // exit events fire in an undefined order — if
        // `proximity:exited` (outer-end) is processed before
        // `proximity:exiting` (inner-end), the latter re-introduces the
        // peer to `pairStates` with state="exiting" and the glow stays
        // on permanently. Spawning at the actual position avoids the
        // phantom frame-1 overlap entirely.
        // Read store directly: `initialState` is frozen at first
        // mount; new peers join after that and need their *current*
        // broadcast position, not the (0,0,0) default.
        const currentPlayer = store.getState().players[p.id];
        const spawn = currentPlayer?.pos ?? { x: 0, y: 0, z: 0 };
        return (
          <RigidBody
            key={p.id}
            type="kinematicPosition"
            colliders={false}
            position={[spawn.x, spawn.y, spawn.z]}
            // playerId on userData lets `SceneFrame` recognise which
            // peer's body the character controller bumped into (the
            // controller resolves movement via the query pipeline so
            // the contact pipeline never fires collision events for
            // these slides — we have to look at the controller's own
            // collision list and map back to a peer ID).
            userData={{ playerId: p.id }}
            ref={(b: RapierRigidBody | null) => {
              if (b) {
                bodyRefs.current.set(p.id, b);
                if (isSelf) selfBodyRef.current = b;
              } else {
                bodyRefs.current.delete(p.id);
                if (isSelf) selfBodyRef.current = null;
              }
            }}
            // Only the local player needs event callbacks — those drive the
            // SDK bus events the rest of the app consumes. Peers' colliders
            // exist so the self body can detect them, but they don't need
            // to emit anything themselves.
            onCollisionEnter={isSelf ? handleCollisionEnter : undefined}
            onIntersectionEnter={isSelf ? handleIntersectionEnter : undefined}
            onIntersectionExit={isSelf ? handleIntersectionExit : undefined}
          >
            <BallCollider
              args={[charRadius]}
              position={[0, BODY_Y, 0]}
              collisionGroups={BODY_GROUPS}
              activeCollisionTypes={ACTIVE_TYPES}
              ref={(c: RapierCollider | null) => {
                if (c) tagByHandle.current.set(c.handle, bodyTag);
              }}
            />
            <BallCollider
              args={[proximityRadius]}
              position={[0, BODY_Y, 0]}
              sensor
              collisionGroups={INNER_SENSOR_GROUPS}
              activeCollisionTypes={ACTIVE_TYPES}
              ref={(c: RapierCollider | null) => {
                if (c) tagByHandle.current.set(c.handle, innerTag);
              }}
            />
            <BallCollider
              args={[proximityOuterRadius]}
              position={[0, BODY_Y, 0]}
              sensor
              collisionGroups={OUTER_SENSOR_GROUPS}
              activeCollisionTypes={ACTIVE_TYPES}
              ref={(c: RapierCollider | null) => {
                if (c) tagByHandle.current.set(c.handle, outerTag);
              }}
            />
            {/* Lift the visible character so its feet (model origin)
                align with the body ball's bottom. The ball is at
                local y=BODY_Y with radius=charRadius, so its bottom
                is at local y=(BODY_Y - charRadius). Without this
                offset the character renders with `root.y` at its
                feet, but the controller resolves contacts at the
                ball's bottom — the character would visually sink
                ~0.5 m into whatever it's standing on. */}
            <group
              position={[0, BODY_Y - charRadius, 0]}
              ref={(g: THREE.Group | null) => {
                if (g) groupRefs.current.set(p.id, g);
                else groupRefs.current.delete(p.id);
              }}
            >
              <PerPlayerAdventurer
                playerId={p.id}
                character={p.character}
                motion={motionByPlayer[p.id] ?? 'idle'}
                invisible={isSelf && cameraMode === 'first-person'}
                animScale={animScaleByPlayer[p.id] ?? 1}
                bumpCounter={bumpCounters[p.id] ?? 0}
                store={store}
                fallbackIdleSpeed={idleAnimSpeed}
                fallbackWalkSpeed={walkAnimSpeed}
                fallbackRunSpeed={runAnimSpeed}
                paused={paused}
              />
            </group>
          </RigidBody>
        );
      })}
    </>
  );
}

/**
 * Per-player Adventurer wrapper that resolves animation speeds against
 * the player's broadcast `avatar.model`. Reads `characterConfigs` via a
 * narrow store subscription so a tuning change in CharacterMode flows
 * through to the right avatar's clip timeScale without re-rendering
 * every avatar.
 *
 * The fallback values are the world-level defaults (so an unconfigured
 * model behaves exactly as before this split).
 */
function PerPlayerAdventurer(props: {
  playerId: string;
  character: CharacterName;
  motion: MotionState;  // now includes 'jumping'
  invisible: boolean;
  animScale: number;
  bumpCounter: number;
  store: Store;
  fallbackIdleSpeed: number;
  fallbackWalkSpeed: number;
  fallbackRunSpeed: number;
  paused?: boolean;
}) {
  const {
    playerId,
    character,
    motion,
    invisible,
    animScale,
    bumpCounter,
    store,
    paused,
  } = props;
  const [tunedSpeeds, setTunedSpeeds] = useState(() => readSpeeds(store, playerId));
  useEffect(() => {
    return store.subscribe(
      (s) => ({
        model: s.players[playerId]?.avatar.model ?? 'default',
        ws: s.worldSettings,
        cc: s.characterConfigs,
      }),
      (next) => {
        const tun = resolveCharacterTunables(next.model, next.ws, next.cc);
        setTunedSpeeds({
          idle: tun.idleAnimSpeed,
          walk: tun.walkAnimSpeed,
          run: tun.runAnimSpeed,
        });
      },
      (a, b) =>
        a.model === b.model && a.ws === b.ws && a.cc === b.cc,
    );
  }, [store, playerId]);
  return (
    <Adventurer
      character={character}
      motion={motion}
      invisible={invisible}
      idleSpeed={tunedSpeeds.idle}
      walkSpeed={tunedSpeeds.walk * animScale}
      runSpeed={tunedSpeeds.run * animScale}
      bumpCounter={bumpCounter}
      paused={paused}
    />
  );
}

function readSpeeds(store: Store, playerId: string) {
  const s = store.getState();
  const model = s.players[playerId]?.avatar.model ?? 'default';
  const tun = resolveCharacterTunables(model, s.worldSettings, s.characterConfigs);
  return { idle: tun.idleAnimSpeed, walk: tun.walkAnimSpeed, run: tun.runAnimSpeed };
}
