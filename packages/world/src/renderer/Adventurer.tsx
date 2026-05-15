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
  /** When true, freeze the character at its bind pose: no clip plays,
   * no fade-in, no bump reactions. Used by the Mugshot mode to render
   * a deterministic, animation-free shot for snapshot testing. */
  paused?: boolean;
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
      paused = false,
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

    // Anchor the model's VISIBLE BOTTOM (= lowest vertex of the
    // bind-pose bounding box) to the inner group's y=0. Combined
    // with the `BODY_Y - charRadius` offset in Players.tsx, the
    // visible bottom ends up at the body ball's bottom — i.e. ON
    // the cube surface the controller resolves contacts against,
    // not above it (mesh floats) or below it (mesh sinks into the
    // floor).
    //
    // Why the bounding-box approach beats "find the toes bone":
    // the toes BONE is the joint, but the foot MESH is skinned
    // around it and extends below — anchoring on the bone alone
    // still buries the visible sole by however thick the foot is.
    // The bounding box captures the actual surface.
    //
    // We measure on the cloned scene before it's mounted, so its
    // matrixWorld === its own matrix (no ancestor contamination).
    // Box3.setFromObject reads each SkinnedMesh's BIND pose extent
    // (not the current animated pose) by walking the geometry's
    // bounding box through bind transforms — exactly the rest
    // position we want.
    //
    // SOLID note: Adventurer owns the MODEL-LOCAL correction (how
    // far below origin does the visible mesh extend?) because
    // that's per-character data. Players.tsx owns the PHYSICS-LOCAL
    // correction (body root → ball bottom) because that's tied to
    // the collider, not the visual.
    const meshOffsetY = useMemo(() => {
      scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(scene);
      if (!isFinite(box.min.y) || !isFinite(box.max.y)) {
        console.warn(
          '[Adventurer] could not measure mesh bbox; character may render with feet buried in the floor',
        );
        return 0;
      }
      const offset = -box.min.y;
      // Diagnostic window-expose for the standing-validation
      // playwright probe. Production code never reads this.
      (
        globalThis as unknown as {
          __OFFICE_MESH_DEBUG__?: {
            minY: number;
            maxY: number;
            offset: number;
          };
        }
      ).__OFFICE_MESH_DEBUG__ = {
        minY: box.min.y,
        maxY: box.max.y,
        offset,
      };
      return offset;
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
      if (paused) return;
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
    }, [activeClipName, actions, previewState, paused]);

    // Apply timeScale to the clips. Done in a separate effect so dragging the
    // Leva slider doesn't restart the animation.
    useEffect(() => {
      if (paused) return;
      const idle = actions[STATE_CLIPS.idle];
      const walk = actions[STATE_CLIPS.walking];
      const run = actions[STATE_CLIPS.running];
      if (idle) idle.timeScale = idleSpeed;
      if (walk) walk.timeScale = walkSpeed;
      if (run) run.timeScale = runSpeed;
    }, [actions, idleSpeed, walkSpeed, runSpeed, paused]);

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
      if (paused) return;
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
    }, [bumpCounter, actions, paused]);

    return (
      <group ref={ref}>
        <group ref={innerRef} position-y={meshOffsetY}>
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
