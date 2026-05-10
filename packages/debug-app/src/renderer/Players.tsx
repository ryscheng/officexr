import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { OfficeState, Store } from '@officexr/sdk';
import { Adventurer } from './Adventurer.tsx';
import { CHARACTERS, type CameraMode, type CharacterName } from './config.ts';

interface PlayersProps {
  store: Store;
  selfId: string;
  cameraMode: CameraMode;
  /** Mutated each frame so the camera rig reads the latest local position. */
  selfPosRef: React.MutableRefObject<THREE.Vector3>;
}

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

/** Rotate `from` toward `to` by at most `maxStep` radians along the shortest arc. */
function stepTowardAngle(from: number, to: number, maxStep: number): number {
  let delta = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= maxStep) return to;
  return from + Math.sign(delta) * maxStep;
}

/**
 * Renders one Adventurer per player in the store. Subscribes to the store
 * for membership changes (player added/removed) but updates positions/yaws
 * via mutable refs inside useFrame to avoid per-frame re-renders.
 */
export function Players({
  store,
  selfId,
  cameraMode,
  selfPosRef,
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
  const { idleAnimSpeed, walkAnimSpeed, turnSpeed } = worldSettings;
  const initialState = useMemo(() => store.getState(), [store]);
  const [players, setPlayers] = useState<PlayerEntry[]>(() =>
    Object.keys(initialState.players).map((id) => ({
      id,
      character: pickCharacter(),
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
            (id) => byId.get(id) ?? { id, character: pickCharacter() },
          );
        });
      },
    );
    return unsubscribe;
  }, [store]);

  const groupRefs = useRef<Map<string, THREE.Group>>(new Map());
  const walkingState = useRef<Map<string, boolean>>(new Map());
  const currentYaw = useRef<Map<string, number>>(new Map());
  const [walkingByPlayer, setWalkingByPlayer] = useState<
    Record<string, boolean>
  >({});

  const tmpVec = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const state = store.getState();
    const now = performance.now();
    let walkingChanged = false;
    const nextWalking: Record<string, boolean> = {};

    for (const [id, player] of Object.entries(state.players)) {
      const grp = groupRefs.current.get(id);
      if (!grp) continue;
      // Extrapolate non-self players forward by their broadcast velocity to
      // smooth between rate-limited network updates (30 Hz broadcast →
      // 60 Hz render).
      const renderPos = extrapolatePos(player, now, tmpVec);
      grp.position.copy(renderPos);

      // Smoothly turn the avatar toward its stored yaw (= movement direction).
      // Camera mouse-look does not affect this — character only rotates when
      // the player actually moves.
      const targetYaw = (player.yaw ?? 0) + AVATAR_YAW_OFFSET;
      const prev = currentYaw.current.get(id) ?? targetYaw;
      grp.rotation.y = stepTowardAngle(prev, targetYaw, turnSpeed * dt);
      currentYaw.current.set(id, grp.rotation.y);

      // `vel` is the authoritative movement-intent state, written by the
      // local player (SceneFrame) and the bot (BotDriver), and re-applied
      // for remote players via applyRemotePosition. Using its magnitude
      // means animation works the same way for everyone.
      const v = player.vel;
      const speedSq = v.x * v.x + v.z * v.z;
      const isWalking = speedSq > WALK_THRESHOLD * WALK_THRESHOLD;
      nextWalking[id] = isWalking;
      if (walkingState.current.get(id) !== isWalking) {
        walkingState.current.set(id, isWalking);
        walkingChanged = true;
      }

      if (id === selfId) {
        selfPosRef.current.copy(renderPos);
      }
    }

    if (walkingChanged) setWalkingByPlayer(nextWalking);
  });

  return (
    <>
      {players.map((p) => (
        <Adventurer
          key={p.id}
          ref={(g: THREE.Group | null) => {
            if (g) groupRefs.current.set(p.id, g);
            else groupRefs.current.delete(p.id);
          }}
          character={p.character}
          walking={walkingByPlayer[p.id] ?? false}
          invisible={p.id === selfId && cameraMode === 'first-person'}
          idleSpeed={idleAnimSpeed}
          walkSpeed={walkAnimSpeed}
        />
      ))}
    </>
  );
}
