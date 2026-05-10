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

/** Max angular velocity for the smooth-turn animation, rad/s. */
const TURN_SPEED = 8;
/** Offset added to player.yaw when rotating the avatar — adjust if the GLB's
 * default facing differs from -Z. KayKit Adventurers point at +Z by default. */
const AVATAR_YAW_OFFSET = Math.PI;

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
  const lastPos = useRef<Map<string, THREE.Vector3>>(new Map());
  const currentYaw = useRef<Map<string, number>>(new Map());
  const [walkingByPlayer, setWalkingByPlayer] = useState<
    Record<string, boolean>
  >({});

  useFrame((_, dt) => {
    const state = store.getState();
    let walkingChanged = false;
    const nextWalking: Record<string, boolean> = {};

    for (const [id, player] of Object.entries(state.players)) {
      const grp = groupRefs.current.get(id);
      if (!grp) continue;
      grp.position.set(player.pos.x, player.pos.y, player.pos.z);

      // Smoothly turn the avatar toward its stored yaw (= movement direction).
      // Camera mouse-look does not affect this — character only rotates when
      // the player actually moves.
      const targetYaw = (player.yaw ?? 0) + AVATAR_YAW_OFFSET;
      const prev = currentYaw.current.get(id) ?? targetYaw;
      grp.rotation.y = stepTowardAngle(prev, targetYaw, TURN_SPEED * dt);
      currentYaw.current.set(id, grp.rotation.y);

      // Detect movement to switch idle/walk anim.
      const last = lastPos.current.get(id);
      const cur = new THREE.Vector3(player.pos.x, player.pos.y, player.pos.z);
      let speed = 0;
      if (last) {
        speed = cur.distanceTo(last) / Math.max(dt, 1 / 240);
      }
      lastPos.current.set(id, cur);
      const isWalking = speed > WALK_THRESHOLD;
      nextWalking[id] = isWalking;
      if (walkingState.current.get(id) !== isWalking) {
        walkingState.current.set(id, isWalking);
        walkingChanged = true;
      }

      if (id === selfId) selfPosRef.current.copy(cur);
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
        />
      ))}
    </>
  );
}
