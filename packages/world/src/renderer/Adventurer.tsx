import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF, useAnimations } from '@react-three/drei';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTERS, type CharacterName } from './config.ts';

const ANIM_GENERAL = '/models/animations/Rig_Medium_General.glb';
const ANIM_MOVEMENT = '/models/animations/Rig_Medium_MovementBasic.glb';
const ANIM_MOVEMENT_ADV = '/models/animations/Rig_Medium_MovementAdvanced.glb';
const ANIM_COMBAT_RANGED = '/models/animations/Rig_Medium_CombatRanged.glb';

useGLTF.preload(ANIM_GENERAL);
useGLTF.preload(ANIM_MOVEMENT);
useGLTF.preload(ANIM_MOVEMENT_ADV);
useGLTF.preload(ANIM_COMBAT_RANGED);
for (const c of CHARACTERS) {
  useGLTF.preload(`/models/characters/${c}.glb`);
}

/**
 * High-level animation state the studio's Character editor exposes.
 * Maps to a canonical clip name in the loaded rigs via {@link STATE_CLIPS}.
 *
 * `idle`/`walking`/`running` continue to be driven by gameplay
 * (movement velocity → motion state); the rest are exposed through
 * `previewState` so the Character editor can show them on demand.
 */
export type AnimationState =
  | 'idle'
  | 'walking'
  | 'running'
  | 'jumping'
  | 'shooting'
  | 'throwing'
  | 'hit';

/**
 * Canonical clip name per state. Pulled from the rigs ANIM_GENERAL +
 * ANIM_MOVEMENT (both required) and ANIM_MOVEMENT_ADV +
 * ANIM_COMBAT_RANGED (optional — added for the Character editor).
 *
 * If a clip is missing at runtime (e.g. CombatRanged GLB failed to
 * load), the Character editor's button for that state is rendered
 * disabled and `playState` falls back to idle. We deliberately don't
 * crash — the studio is still useful with whatever rigs do load.
 */
export const STATE_CLIPS: Record<AnimationState, string> = {
  idle: 'Idle_A',
  walking: 'Walking_C',
  running: 'Running_A',
  jumping: 'Jump_Full_Long',
  shooting: '1H_Ranged_Shoot',
  throwing: '2H_Ranged_Throwing',
  hit: 'Hit_A',
};

/** Faster than authored so the bump reads as a quick recoil, not a flinch. */
const HIT_TIME_SCALE = 1.6;

/** States that loop. The rest play once and clamp at the end frame so
 * the editor's "snapshot" feels stable. */
const LOOPING_STATES: ReadonlySet<AnimationState> = new Set([
  'idle',
  'walking',
  'running',
]);

interface AdventurerProps {
  character: CharacterName;
  /** Which clip the GAMEPLAY layer should loop. Comes from the
   * velocity-derived motion state in `Players.tsx`. */
  motion: 'idle' | 'walking' | 'running';
  /**
   * Optional preview override owned by the Character editor. When
   * non-null, plays this state's clip in place of `motion`'s. Setting
   * back to `undefined` returns control to gameplay-driven motion.
   */
  previewState?: AnimationState;
  /** If true, hide the body so first-person view doesn't see itself. */
  invisible?: boolean;
  /** Time-scale multiplier for the idle clip (1 = authored speed). */
  idleSpeed?: number;
  /** Time-scale multiplier for the walking clip. */
  walkSpeed?: number;
  /** Time-scale multiplier for the run clip. */
  runSpeed?: number;
  /** Monotonic counter — every increment plays the Hit_A reaction clip
   * once, blended over the current idle/walk loop. */
  bumpCounter?: number;
}

function clipForMotion(motion: AdventurerProps['motion']): string {
  return motion === 'running'
    ? STATE_CLIPS.running
    : motion === 'walking'
      ? STATE_CLIPS.walking
      : STATE_CLIPS.idle;
}

/**
 * Renders one Adventurer GLB with idle/walk animations applied. The position
 * and yaw of the wrapping <group> is mutated externally each frame (avoids
 * per-frame React re-renders).
 */
export const Adventurer = React.forwardRef<THREE.Group, AdventurerProps>(
  function Adventurer(
    {
      character,
      motion,
      previewState,
      invisible,
      idleSpeed = 1,
      walkSpeed = 1,
      runSpeed = 1,
      bumpCounter = 0,
    },
    ref,
  ) {
    const url = `/models/characters/${character}.glb`;
    const character_gltf = useGLTF(url);
    const general = useGLTF(ANIM_GENERAL);
    const movement = useGLTF(ANIM_MOVEMENT);
    const movementAdv = useGLTF(ANIM_MOVEMENT_ADV);
    const combatRanged = useGLTF(ANIM_COMBAT_RANGED);

    // Each Adventurer instance must own its own scene graph — useGLTF caches
    // a single scene per URL, and SkeletonUtils.clone preserves the skin.
    // While we're at it, enable shadow casting on every mesh in the
    // hierarchy so the sun's directionalLight bakes a silhouette onto
    // the floor (which has `receiveShadow`). `receiveShadow` is also on
    // so characters cast onto each other.
    const scene = useMemo(() => {
      const s = cloneSkinned(character_gltf.scene);
      s.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      return s;
    }, [character_gltf.scene]);

    // Measure the y-coordinate of the toes bones in the model's
    // BIND POSE (we run this before the animation mixer has a chance
    // to advance the skeleton — useMemo runs during render; mixer
    // updates run inside useFrame after first commit). The character
    // mesh is positioned so toes land at the parent group's y=0;
    // combined with the `BODY_Y - charRadius` offset in Players.tsx,
    // toes end up exactly at the body ball's bottom — i.e. ON the
    // cube surface the controller resolves against, not buried
    // inside it.
    //
    // SOLID note: Adventurer owns the MODEL-LOCAL correction (where
    // are the toes relative to the GLB's origin?) because that
    // varies by character. Players.tsx owns the PHYSICS-LOCAL
    // correction (where is the ball's bottom relative to the body
    // root?) because that's tied to the collider, not the visual.
    const toesOffsetY = useMemo(() => {
      // We need the toes' y-coord in the scene's LOCAL frame, not
      // world frame — if `scene` is already mounted (HMR re-run,
      // StrictMode double-invoke), `getWorldPosition` would include
      // the ancestor transforms we're about to set, leading to a
      // feedback loop. Instead: compute `sceneWorld⁻¹ · boneWorld`
      // explicitly so the offset is always referenced to scene root.
      scene.updateMatrixWorld(true);
      const sceneInverse = new THREE.Matrix4()
        .copy(scene.matrixWorld)
        .invert();
      const m = new THREE.Matrix4();
      const tmp = new THREE.Vector3();
      const ys: number[] = [];
      scene.traverse((node) => {
        const lname = (node.name ?? '').toLowerCase();
        // Match `toesl` / `toesr` (KayKit) and also common rig
        // variants like `:LeftToes` (Mixamo) or `toes_l` (Blender).
        // Endings only — the bone's name may carry a rig prefix
        // like `mixamorig:`.
        if (
          lname === 'toesl' ||
          lname === 'toesr' ||
          lname.endsWith(':toesl') ||
          lname.endsWith(':toesr') ||
          lname.endsWith('toes_l') ||
          lname.endsWith('toes_r') ||
          lname.endsWith('lefttoes') ||
          lname.endsWith('righttoes')
        ) {
          m.copy(sceneInverse).multiply(node.matrixWorld);
          tmp.setFromMatrixPosition(m);
          ys.push(tmp.y);
        }
      });
      if (ys.length === 0) {
        // No toes bone found — fall back to "model origin == feet"
        // and rely on Players.tsx's static offset. Log once per
        // character so a future rig swap with a different naming
        // convention surfaces in the console.
        console.warn(
          '[Adventurer] no toes bone found; character may render with feet buried in the floor',
        );
        return 0;
      }
      const avg = ys.reduce((s, y) => s + y, 0) / ys.length;
      return -avg;
    }, [scene]);

    // Merge clips from every loaded rig. Earlier rigs win on name
    // collision (rare — Idle_A only lives in General, Walking_C only
    // in MovementBasic, etc.).
    const clips = useMemo(() => {
      const seen = new Set<string>();
      const out: THREE.AnimationClip[] = [];
      for (const c of [
        ...general.animations,
        ...movement.animations,
        ...movementAdv.animations,
        ...combatRanged.animations,
      ]) {
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        out.push(c);
      }
      return out;
    }, [
      general.animations,
      movement.animations,
      movementAdv.animations,
      combatRanged.animations,
    ]);

    const innerRef = useRef<THREE.Group>(null!);
    const { actions } = useAnimations(clips, innerRef);

    // Resolve which clip to play. Preview state takes precedence over
    // the gameplay-driven motion. Falls back to idle if the requested
    // clip isn't in the loaded rigs (e.g. CombatRanged failed to load).
    const activeClipName = useMemo(() => {
      if (previewState) {
        const desired = STATE_CLIPS[previewState];
        if (actions[desired]) return desired;
        return STATE_CLIPS.idle;
      }
      return clipForMotion(motion);
    }, [previewState, motion, actions]);

    useEffect(() => {
      const target = actions[activeClipName];
      if (!target) return;
      // Non-looping previews (jump/shoot/throw) clamp at the final
      // frame so the editor's "show me this pose" feels stable.
      const isLooping =
        !previewState || LOOPING_STATES.has(previewState);
      if (isLooping) {
        target.setLoop(THREE.LoopRepeat, Infinity);
        target.clampWhenFinished = false;
      } else {
        target.setLoop(THREE.LoopOnce, 1);
        target.clampWhenFinished = true;
      }
      target.reset().fadeIn(0.2).play();
      return () => {
        target.fadeOut(0.2);
      };
    }, [activeClipName, actions, previewState]);

    // Apply timeScale to the clips. Done in a separate effect so dragging the
    // Leva slider doesn't restart the animation.
    useEffect(() => {
      const idle = actions[STATE_CLIPS.idle];
      const walk = actions[STATE_CLIPS.walking];
      const run = actions[STATE_CLIPS.running];
      if (idle) idle.timeScale = idleSpeed;
      if (walk) walk.timeScale = walkSpeed;
      if (run) run.timeScale = runSpeed;
    }, [actions, idleSpeed, walkSpeed, runSpeed]);

    // First-person mode: the camera sits at the self avatar's eye
    // level, so the head mesh would obstruct the view (and we'd see
    // the inside of the skull). Instead of hiding the whole model
    // (which also kills its shadow), find the head bone and collapse
    // it to a point — body, hands and feet stay visible and keep
    // casting shadows, but the head's geometry disappears. KayKit
    // characters name the head bone `head` (lowercase) consistently
    // across models; we match any bone or mesh whose name contains
    // "head" to stay robust to renames.
    useEffect(() => {
      const targets: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if (/head/i.test(o.name)) targets.push(o);
      });
      for (const t of targets) {
        if (invisible) t.scale.setScalar(0);
        else t.scale.setScalar(1);
      }
      // Keep the rest of the scene visible — its shadow still falls
      // on the floor regardless of camera mode.
      scene.visible = true;
    }, [scene, invisible]);

    // Play the Hit_A clip as a one-shot whenever bumpCounter ticks. The
    // underlying idle/walk action is left running; Hit blends in on top
    // for the duration of its clip and is faded back out near the end so
    // the loop seamlessly takes over again.
    const lastBumpRef = useRef(0);
    useEffect(() => {
      if (bumpCounter === 0 || bumpCounter === lastBumpRef.current) return;
      lastBumpRef.current = bumpCounter;
      const hit = actions[STATE_CLIPS.hit];
      if (!hit) return;
      hit.reset();
      hit.setLoop(THREE.LoopOnce, 1);
      hit.clampWhenFinished = true;
      hit.timeScale = HIT_TIME_SCALE;
      hit.fadeIn(0.05).play();
      const durMs = (hit.getClip().duration / HIT_TIME_SCALE) * 1000;
      const fadeOutAt = Math.max(0, durMs - 120);
      const fadeId = setTimeout(() => hit.fadeOut(0.18), fadeOutAt);
      return () => {
        clearTimeout(fadeId);
        // If a fresh bump arrives mid-clip, snap-stop so the next play()
        // starts cleanly.
        hit.stop();
      };
    }, [bumpCounter, actions]);

    return (
      <group ref={ref}>
        <group ref={innerRef} position-y={toesOffsetY}>
          <primitive object={scene} />
        </group>
      </group>
    );
  },
);

/** True iff the rig that ships the named state's clip is available
 * at runtime (i.e. its GLB loaded and the clip name is present). The
 * Character editor uses this to disable buttons for states that
 * weren't loaded — no spurious "click but nothing animates". */
export function isAnimationStateAvailable(
  state: AnimationState,
  loadedClipNames: ReadonlySet<string>,
): boolean {
  return loadedClipNames.has(STATE_CLIPS[state]);
}
