import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF, useAnimations } from '@react-three/drei';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { modelUrl } from '../app/asset-url.ts';
import { characterUrl } from '../characters/registry.ts';
import { createSitPoseClip, SIT_CLIP_NAME } from './sitPoseClip.ts';
import { createPokeClip, POKE_CLIP_NAME } from './pokeClip.ts';
import { CAST_CLIP_NAME, createCastClip } from './castClip.ts';
import { useFrame } from '@react-three/fiber';
import { applyFrozenLook } from './frozenLook.ts';

const ANIM_GENERAL = modelUrl('/models/animations/Rig_Medium_General.glb');
const ANIM_MOVEMENT = modelUrl('/models/animations/Rig_Medium_MovementBasic.glb');
const ANIM_MOVEMENT_ADV = modelUrl('/models/animations/Rig_Medium_MovementAdvanced.glb');
const ANIM_COMBAT_RANGED = modelUrl('/models/animations/Rig_Medium_CombatRanged.glb');
export const ANIMATION_URLS = [ANIM_GENERAL, ANIM_MOVEMENT, ANIM_MOVEMENT_ADV, ANIM_COMBAT_RANGED];

export { characterUrl };

export const GHOST_OPACITY = 0.6;

/**
 * Gives every mesh in `scene` its own translucent copy of its material(s), leaving the shared `useGLTF`
 * materials untouched. Returns the copies; the caller owns them and must dispose them.
 */
export function applyGhostMaterials(scene: THREE.Object3D): THREE.Material[] {
  const clones: THREE.Material[] = [];
  const ghostOf = (m: THREE.Material) => {
    const c = m.clone();
    c.transparent = true;
    c.opacity = GHOST_OPACITY;
    // Without this, the ghost's own back faces occlude its front ones.
    c.depthWrite = false;
    clones.push(c);
    return c;
  };
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = Array.isArray(m.material) ? m.material.map(ghostOf) : ghostOf(m.material);
    }
  });
  return clones;
}

function cloneOwn(material: THREE.Material, own: THREE.Material[]): THREE.Material {
  const c = material.clone();
  own.push(c);
  return c;
}

const sitPoseClip = createSitPoseClip();
const pokeClip = createPokeClip();
const castClip = createCastClip();

/** What a spell does to a character's colours, set each frame by `Players` and read by its `Adventurer`. */
export interface AvatarFx {
  tint: string | null;
  strength: number;
  glow: boolean;
}

export const newAvatarFx = (): AvatarFx => ({ tint: null, strength: 0, glow: false });

for (const url of ANIMATION_URLS) {
  useGLTF.preload(url);
}

/** Starts downloading character models that are about to be shown, so a model is not first requested when its avatar mounts. */
export function preloadCharacterModels(urls: Iterable<string>): void {
  for (const url of new Set(urls)) {
    useGLTF.preload(url);
  }
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
  | 'hit'
  | 'sitting';

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
  sitting: SIT_CLIP_NAME,
};

/** The poke clip drives only the arm and the mixer averages it with the clip below; this weight lets it win. */
const POKE_ARM_WEIGHT = 8;

/** Faster than authored so the bump reads as a quick recoil, not a flinch. */
const HIT_TIME_SCALE = 1.6;

/** States that loop. The rest play once and clamp at the end frame so
 * the editor's "snapshot" feels stable. */
const LOOPING_STATES: ReadonlySet<AnimationState> = new Set([
  'idle',
  'walking',
  'running',
  'jumping',  // loops while airborne
  'sitting',
]);

export type MotionState = Extract<
  AnimationState,
  'idle' | 'walking' | 'running' | 'jumping' | 'sitting'
>;

interface AdventurerProps {
  /** The GLB to load, e.g. `characterUrl(character)`. */
  url: string;
  /** Translucent, shadowless rendering for 2D-mode players. */
  ghost?: boolean;
  /** Grey, translucent and rimmed: an absent person's avatar left at their desk. */
  frozen?: boolean;
  /** Which clip the GAMEPLAY layer should loop. Derived in `Players.tsx` from
   * the player's seat, airborne state and speed. */
  motion: MotionState;
  /**
   * Optional preview override owned by the Character editor. When
   * non-null, plays this state's clip in place of `motion`'s. Setting
   * back to `undefined` returns control to gameplay-driven motion.
   */
  previewState?: AnimationState;
  /** If true, hide the body so first-person view doesn't see itself. */
  invisible?: boolean;
  clipOverride?: { name: string; timeScale: number };
  pokeCounter?: number;
  /** Holding the wand: it shows in the right hand. */
  held?: boolean;
  /** Monotonic counter: every increment waves the wand once. */
  castCounter?: number;
  fxRef?: React.MutableRefObject<AvatarFx>;
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

/**
 * Renders one Adventurer GLB with idle/walk animations applied. The position
 * and yaw of the wrapping <group> is mutated externally each frame (avoids
 * per-frame React re-renders).
 */
export const Adventurer = React.forwardRef<THREE.Group, AdventurerProps>(
  function Adventurer(
    {
      url,
      ghost = false,
      frozen = false,
      motion,
      previewState,
      clipOverride,
      pokeCounter = 0,
      held = false,
      castCounter = 0,
      fxRef,
      invisible,
      idleSpeed = 1,
      walkSpeed = 1,
      runSpeed = 1,
      bumpCounter = 0,
      paused = false,
    },
    ref,
  ) {
    const character_gltf = useGLTF(url);
    const general = useGLTF(ANIM_GENERAL);
    const movement = useGLTF(ANIM_MOVEMENT);
    const movementAdv = useGLTF(ANIM_MOVEMENT_ADV);
    const combatRanged = useGLTF(ANIM_COMBAT_RANGED);

    // Each Adventurer instance must own its own scene graph — useGLTF caches
    // a single scene per URL, and SkeletonUtils.clone preserves the skin.
    // Ghosts get translucent materials and no shadows; every other
    // character casts onto the floor (which has `receiveShadow`) and,
    // with `receiveShadow` on too, onto each other.
    const { scene, ghostMaterials } = useMemo(() => {
      const s = cloneSkinned(character_gltf.scene);
      if (ghost) {
        return { scene: s, ghostMaterials: applyGhostMaterials(s) };
      }
      const own: THREE.Material[] = [];
      s.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
          // Spells recolour this character only, so it must not share the cached glTF materials.
          m.material = Array.isArray(m.material) ? m.material.map((x) => cloneOwn(x, own)) : cloneOwn(m.material, own);
        }
      });
      if (frozen) {
        applyFrozenLook(own);
      }
      return { scene: s, ghostMaterials: own };
    }, [character_gltf.scene, ghost, frozen]);
    const tintable = useMemo(
      () =>
        ghostMaterials
          .filter((m): m is THREE.MeshStandardMaterial => (m as THREE.MeshStandardMaterial).isMeshStandardMaterial)
          .map((m) => ({ material: m, base: m.color.clone() })),
      [ghostMaterials],
    );
    const tintColor = useMemo(() => new THREE.Color(), []);
    const appliedTint = useRef('');
    useFrame(() => {
      const fx = fxRef?.current;
      const key = fx && fx.tint ? `${fx.tint}|${fx.strength.toFixed(2)}|${fx.glow}` : '';
      if (key === appliedTint.current) return;
      appliedTint.current = key;
      if (fx?.tint) tintColor.set(fx.tint);
      for (const { material, base } of tintable) {
        if (fx?.tint) {
          material.color.copy(base).lerp(tintColor, fx.strength);
          if (fx.glow) {
            material.emissive.copy(tintColor);
            material.emissiveIntensity = fx.strength * 0.7;
          } else {
            material.emissiveIntensity = 0;
          }
        } else {
          material.color.copy(base);
          material.emissiveIntensity = 0;
        }
      }
    });
    useEffect(
      () => () => {
        for (const m of ghostMaterials) {
          m.dispose();
        }
      },
      [ghostMaterials],
    );

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
        sitPoseClip,
        pokeClip,
        castClip,
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

    // -----------------------------------------------------------------
    // Per-character mesh anchor: place the model's bind-pose LOWEST
    // visible vertex at the inner group's local y=0.
    //
    // Why this exists
    //   The Rapier body collider is a ball at local `BODY_Y=0.9`
    //   with radius `charRadius=0.4`, so its bottom sits at
    //   `root.y + 0.5`. Players.tsx wraps the character in a group
    //   offset by `BODY_Y - charRadius = 0.5`; the wrapper's local
    //   y=0 sits at the ball's bottom — the surface the controller
    //   thinks the character stands on. Our job is to place the
    //   model so its bind-pose feet land at THAT y=0.
    //
    // Why bind-pose only (no per-frame sampling)
    //   The character controller settles on the BALL collider, not
    //   the visible mesh. The mesh is purely cosmetic. An earlier
    //   version of this hook sampled every loaded clip at 12 frames
    //   per clip and used `-(union.min.y)` so the model would never
    //   dip into a cube during a stride. Net effect: in every frame
    //   except the deepest stride dip the model rendered LIFTED
    //   above the surface by the dip depth — most visibly a 5-10 cm
    //   constant float in idle pose. We accept a 3-6 cm momentary
    //   foot-into-cube clip on the lowest stride frame in exchange
    //   for the character actually standing on the surface the rest
    //   of the time. If a particular clip ever clips visibly
    //   enough to bother a user, the surgical fix is to tweak the
    //   clip's foot-Y curve in the GLB, not to add a global lift.
    //
    // The frame trick: `SkinnedMesh.computeBoundingBox()` writes
    //   the result in SkinnedMesh-LOCAL frame (bindMatrix and
    //   bindMatrixInverse bracket the bone math and cancel back to
    //   mesh-local). To get scene-local — what we need for the
    //   innerRef offset — we apply `skin.matrixWorld` to the box.
    //   Without this step, a non-identity ancestor transform on the
    //   SkinnedMesh produces a stale frame mismatch that sinks the
    //   visible character. Static meshes use the same pattern
    //   (`geometry.boundingBox.applyMatrix4(mesh.matrixWorld)`).
    //
    // SOLID split
    //   Adventurer owns the MODEL-LOCAL anchor (per-character data
    //   from the rig). Players.tsx owns the PHYSICS-LOCAL anchor
    //   (body root → ball bottom, identical for every character).
    //   Together they place bind-pose feet on the floor for any
    //   rig.
    //
    // Diagnostics in `__OFFICE_MESH_DEBUG__`: `minY` is the bind-
    //   pose min y; `maxY` is the bind-pose max y; `offset` is what
    //   we pass to innerRef. Tests assert these are sane.
    // -----------------------------------------------------------------
    const meshOffsetY = useMemo(() => {
      scene.updateMatrixWorld(true);

      const acc = new THREE.Box3();
      acc.makeEmpty();
      const tmp = new THREE.Box3();

      scene.traverse((obj) => {
        const skin = obj as THREE.SkinnedMesh;
        if (skin.isSkinnedMesh && skin.skeleton) {
          skin.skeleton.update();
          skin.computeBoundingBox();
          if (!skin.boundingBox || skin.boundingBox.isEmpty()) return;
          // SkinnedMesh.computeBoundingBox writes to skin.boundingBox
          // in MESH-LOCAL frame (bindMatrix/bindMatrixInverse cancel
          // the bone math back to mesh-local). Lift into scene-local
          // by applying matrixWorld — the production render path
          // does this via the shader, so we have to match.
          tmp.copy(skin.boundingBox).applyMatrix4(skin.matrixWorld);
          acc.union(tmp);
          return;
        }
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          if (!mesh.geometry.boundingBox) return;
          tmp.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
          acc.union(tmp);
        }
      });

      if (acc.isEmpty() || !isFinite(acc.min.y) || !isFinite(acc.max.y)) {
        console.warn(
          '[Adventurer] could not measure mesh bbox; character may render with feet buried in the floor',
        );
        return 0;
      }
      const offset = -acc.min.y;
      (
        globalThis as unknown as {
          __OFFICE_MESH_DEBUG__?: {
            minY: number;
            maxY: number;
            offset: number;
          };
        }
      ).__OFFICE_MESH_DEBUG__ = {
        minY: acc.min.y,
        maxY: acc.max.y,
        offset,
      };
      return offset;
      // Recomputes once per cloned scene — bind pose is invariant
      // to whether playback is paused, so `paused` is not in deps.
    }, [scene]);

    const innerRef = useRef<THREE.Group>(null!);
    const { actions } = useAnimations(clips, innerRef);

    // Resolve which clip to play. Preview state takes precedence over
    // the gameplay-driven motion. Falls back to idle if the requested
    // clip isn't in the loaded rigs (e.g. CombatRanged failed to load).
    const activeClipName = useMemo(() => {
      if (clipOverride && actions[clipOverride.name]) return clipOverride.name;
      if (previewState) {
        const desired = STATE_CLIPS[previewState];
        if (actions[desired]) return desired;
        return STATE_CLIPS.idle;
      }
      return STATE_CLIPS[motion];
    }, [previewState, motion, actions, clipOverride?.name]);

    useEffect(() => {
      if (paused) return;
      const target = actions[activeClipName];
      if (!target) return;
      // Non-looping previews (jump/shoot/throw) clamp at the final
      // frame so the editor's "show me this pose" feels stable.
      const isLooping =
        clipOverride !== undefined || !previewState || LOOPING_STATES.has(previewState);
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

    useEffect(() => {
      if (paused || !clipOverride) return;
      const action = actions[clipOverride.name];
      if (action) action.timeScale = clipOverride.timeScale;
    }, [actions, clipOverride?.name, clipOverride?.timeScale, paused]);

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
      if (motion === 'sitting') return;
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
      // motion is deliberately not a dep: a motion change must not cut a running Hit_A.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bumpCounter, actions, paused]);

    const finger = useMemo(() => {
      const mesh = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.035, 0.2, 4, 8),
        new THREE.MeshStandardMaterial({ color: '#f2c19a', roughness: 0.6 }),
      );
      mesh.rotation.z = -Math.PI / 2;
      mesh.position.set(0.2, 0, 0);
      mesh.visible = false;
      mesh.castShadow = true;
      return mesh;
    }, []);
    useEffect(() => {
      const hand = scene.getObjectByName('handr');
      hand?.add(finger);
      return () => {
        hand?.remove(finger);
      };
    }, [scene, finger]);
    const wand = useMemo(() => createHeldWand(), []);
    useEffect(() => {
      const hand = scene.getObjectByName('handr');
      hand?.add(wand);
      return () => {
        hand?.remove(wand);
      };
    }, [scene, wand]);
    useEffect(() => {
      wand.visible = held;
    }, [wand, held]);
    const lastCastRef = useRef(0);
    useEffect(() => {
      if (paused || castCounter === 0 || castCounter === lastCastRef.current) return;
      lastCastRef.current = castCounter;
      const cast = actions[CAST_CLIP_NAME];
      if (!cast) return;
      cast.reset();
      cast.setEffectiveWeight(POKE_ARM_WEIGHT);
      cast.setLoop(THREE.LoopOnce, 1);
      cast.clampWhenFinished = false;
      cast.fadeIn(0.05).play();
      const fadeId = setTimeout(() => cast.fadeOut(0.15), Math.max(0, cast.getClip().duration * 1000 - 160));
      return () => {
        clearTimeout(fadeId);
        cast.stop();
      };
    }, [castCounter, actions, paused]);
    const lastPokeRef = useRef(0);
    useEffect(() => {
      if (paused || pokeCounter === 0 || pokeCounter === lastPokeRef.current) return;
      lastPokeRef.current = pokeCounter;
      const poke = actions[POKE_CLIP_NAME];
      if (!poke) return;
      poke.reset();
      poke.setEffectiveWeight(POKE_ARM_WEIGHT);
      poke.setLoop(THREE.LoopOnce, 1);
      poke.clampWhenFinished = false;
      poke.fadeIn(0.05).play();
      finger.visible = true;
      const fadeId = setTimeout(() => poke.fadeOut(0.12), Math.max(0, poke.getClip().duration * 1000 - 130));
      const fingerId = setTimeout(() => {
        finger.visible = false;
      }, poke.getClip().duration * 1000 - 100);
      return () => {
        clearTimeout(fadeId);
        clearTimeout(fingerId);
        finger.visible = false;
        poke.stop();
      };
    }, [pokeCounter, actions, paused, finger]);

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

export const WAND_TIP_COLOR = '#ffe27a';

/** A wand lying along the right hand bone's +X, grip at the bone origin; hidden until held. */
export function createHeldWand(): THREE.Group {
  const group = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.02, 0.42, 8),
    new THREE.MeshStandardMaterial({ color: '#6b3f1d', roughness: 0.7 }),
  );
  shaft.rotation.z = -Math.PI / 2;
  shaft.position.x = 0.2;
  shaft.castShadow = true;
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 10, 8),
    new THREE.MeshBasicMaterial({ color: WAND_TIP_COLOR }),
  );
  tip.position.x = 0.43;
  group.add(shaft, tip);
  group.visible = false;
  return group;
}
