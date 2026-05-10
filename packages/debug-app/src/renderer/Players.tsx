import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Bus, OfficeState, Store } from '@officexr/sdk';
import { Adventurer } from './Adventurer.tsx';
import { CHARACTERS, type CameraMode, type CharacterName } from './config.ts';

interface PlayersProps {
  store: Store;
  bus: Bus;
  selfId: string;
  cameraMode: CameraMode;
  /** Mutated each frame so the camera rig reads the latest local position. */
  selfPosRef: React.MutableRefObject<THREE.Vector3>;
}

interface BumpState {
  /** ms since unix-epoch-ish timestamp when the bump was registered. */
  startMs: number;
  /** Push direction (away from the other character). */
  normal: { x: number; z: number };
}

/** What animation tier a character is currently in. Derived per-frame from
 * |player.vel| against the broadcast walk and run speeds. */
type MotionState = 'idle' | 'walking' | 'running';

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
  bus,
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
  const {
    idleAnimSpeed,
    walkAnimSpeed,
    runAnimSpeed,
    turnSpeed,
    playerSpeed,
    runSpeedMultiplier,
  } = worldSettings;
  const runSpeed = playerSpeed * runSpeedMultiplier;
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
  // Per-player motion state: 'idle' | 'walking' | 'running'. Mutually
  // exclusive — running implies fast enough that we should swap to the
  // run clip; walking means moving but below the run threshold.
  const motionState = useRef<Map<string, MotionState>>(new Map());
  const currentYaw = useRef<Map<string, number>>(new Map());
  const [motionByPlayer, setMotionByPlayer] = useState<
    Record<string, MotionState>
  >({});
  // animScale is |vel|/playerSpeed quantised to 0.1 so the Adventurer's
  // walk timeScale prop only re-renders ~10 times across full→stopped, not
  // every frame. The driver below tracks the *current* quantised value per
  // player and only calls setState when it crosses a step.
  const [animScaleByPlayer, setAnimScaleByPlayer] = useState<
    Record<string, number>
  >({});
  const animScaleQuant = useRef<Map<string, number>>(new Map());

  // Active bumps: SceneFrame's per-frame edge detector emits a pair of
  // collision:char-bump events when two characters cross into contact. Each
  // event drives both (a) the decaying additive XZ offset below, and (b) a
  // bump counter that triggers the Hit_A one-shot animation in Adventurer.
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

  useFrame((_, dt) => {
    const state = store.getState();
    const now = performance.now();
    let motionChanged = false;
    const nextMotion: Record<string, MotionState> = {};
    let animScaleChanged = false;
    const nextAnimScales: Record<string, number> = {};
    // Threshold separating walk-tier from run-tier velocity: midpoint of
    // playerSpeed and runSpeed. A character partially-blocked while running
    // (e.g. 50% progress at 6 m/s = 3 m/s) drops back into walk tier — that
    // matches the actual ground speed and looks right.
    const runThreshold = (playerSpeed + runSpeed) / 2;
    // Hysteresis bands prevent state flicker when |vel| hovers near a
    // threshold (which is exactly what happens when bots wedge against
    // each other). Each transition uses a different bound:
    //   idle → walking when |vel| > WALK_THRESHOLD * 1.5
    //   walking → idle when |vel| < WALK_THRESHOLD
    //   walking → running when |vel| > runThreshold * 1.05
    //   running → walking when |vel| < runThreshold * 0.95
    const WALK_ENTER_SQ = (WALK_THRESHOLD * 1.5) * (WALK_THRESHOLD * 1.5);
    const WALK_EXIT_SQ = WALK_THRESHOLD * WALK_THRESHOLD;
    const RUN_ENTER_SQ = (runThreshold * 1.05) * (runThreshold * 1.05);
    const RUN_EXIT_SQ = (runThreshold * 0.95) * (runThreshold * 0.95);

    for (const [id, player] of Object.entries(state.players)) {
      const grp = groupRefs.current.get(id);
      if (!grp) continue;
      // Extrapolate non-self players forward by their broadcast velocity to
      // smooth between rate-limited network updates (30 Hz broadcast →
      // 60 Hz render).
      const renderPos = extrapolatePos(player, now, tmpVec);
      // Apply char-bump easing if active. Damped-oscillator envelope —
      //   offset(t) = kick · e^(-decay·t) · cos(2π·freq·t)
      // gives a sharp push out at t=0, a small spring back through neutral,
      // and settle. Kick magnitude is the *peak*; the cos modulation flips
      // sign during the cycle, which is what produces the "bump-back" feel.
      const bump = bumps.current.get(id);
      let bumpX = 0;
      let bumpZ = 0;
      if (bump) {
        const elapsed = now - bump.startMs;
        const dur = worldSettings.bumpEasingMs;
        if (elapsed >= dur) {
          bumps.current.delete(id);
        } else {
          const t = elapsed / dur; // 0..1 across bumpEasingMs
          const decay = Math.exp(-3.2 * t);
          const wave = Math.cos(2 * Math.PI * 1.1 * t);
          const env = decay * wave;
          const kick = 0.16; // metres at peak
          bumpX = bump.normal.x * env * kick;
          bumpZ = bump.normal.z * env * kick;
        }
      }
      grp.position.set(
        renderPos.x + bumpX,
        renderPos.y,
        renderPos.z + bumpZ,
      );

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
      const previous = motionState.current.get(id) ?? 'idle';
      let motion: MotionState = previous;
      // State machine with hysteresis — only transition when |vel|² crosses
      // the *enter* threshold for a different state, never on jitter near
      // the *exit* boundary of the current one.
      if (previous === 'idle') {
        if (speedSq >= RUN_ENTER_SQ) motion = 'running';
        else if (speedSq >= WALK_ENTER_SQ) motion = 'walking';
      } else if (previous === 'walking') {
        if (speedSq >= RUN_ENTER_SQ) motion = 'running';
        else if (speedSq <= WALK_EXIT_SQ) motion = 'idle';
      } else {
        // running
        if (speedSq <= WALK_EXIT_SQ) motion = 'idle';
        else if (speedSq <= RUN_EXIT_SQ) motion = 'walking';
      }
      nextMotion[id] = motion;
      if (previous !== motion) {
        motionState.current.set(id, motion);
        motionChanged = true;
      }

      // Anim-rate scales with actual speed in the current tier so the
      // footsteps stay aligned with the ground. Walk tier divides by
      // playerSpeed; run tier divides by runSpeed. Quantise to 0.1 to bound
      // prop-driven re-renders.
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
          motion={motionByPlayer[p.id] ?? 'idle'}
          invisible={p.id === selfId && cameraMode === 'first-person'}
          idleSpeed={idleAnimSpeed}
          walkSpeed={walkAnimSpeed * (animScaleByPlayer[p.id] ?? 1)}
          runSpeed={runAnimSpeed * (animScaleByPlayer[p.id] ?? 1)}
          bumpCounter={bumpCounters[p.id] ?? 0}
        />
      ))}
    </>
  );
}
