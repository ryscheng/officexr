import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF, useAnimations } from '@react-three/drei';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CHARACTERS, type CharacterName } from './config.ts';

const ANIM_GENERAL = '/models/animations/Rig_Medium_General.glb';
const ANIM_MOVEMENT = '/models/animations/Rig_Medium_MovementBasic.glb';

useGLTF.preload(ANIM_GENERAL);
useGLTF.preload(ANIM_MOVEMENT);
for (const c of CHARACTERS) {
  useGLTF.preload(`/models/characters/${c}.glb`);
}

interface AdventurerProps {
  character: CharacterName;
  /** True when the player is moving — switches to walk animation. */
  walking: boolean;
  /** If true, hide the body so first-person view doesn't see itself. */
  invisible?: boolean;
  /** Time-scale multiplier for the idle clip (1 = authored speed). */
  idleSpeed?: number;
  /** Time-scale multiplier for the walking clip. */
  walkSpeed?: number;
  /** Monotonic counter — every increment plays the Hit_A reaction clip
   * once, blended over the current idle/walk loop. */
  bumpCounter?: number;
}

const IDLE_CLIP = 'Idle_A';
const WALK_CLIP = 'Walking_C';
const HIT_CLIP = 'Hit_A';
/** Faster than authored so the bump reads as a quick recoil, not a flinch. */
const HIT_TIME_SCALE = 1.6;

/**
 * Renders one Adventurer GLB with idle/walk animations applied. The position
 * and yaw of the wrapping <group> is mutated externally each frame (avoids
 * per-frame React re-renders).
 */
export const Adventurer = React.forwardRef<THREE.Group, AdventurerProps>(
  function Adventurer(
    {
      character,
      walking,
      invisible,
      idleSpeed = 1,
      walkSpeed = 1,
      bumpCounter = 0,
    },
    ref,
  ) {
    const url = `/models/characters/${character}.glb`;
    const character_gltf = useGLTF(url);
    const general = useGLTF(ANIM_GENERAL);
    const movement = useGLTF(ANIM_MOVEMENT);

    // Each Adventurer instance must own its own scene graph — useGLTF caches
    // a single scene per URL, and SkeletonUtils.clone preserves the skin.
    const scene = useMemo(
      () => cloneSkinned(character_gltf.scene),
      [character_gltf.scene],
    );

    const clips = useMemo(
      () => [...general.animations, ...movement.animations],
      [general.animations, movement.animations],
    );

    const innerRef = useRef<THREE.Group>(null!);
    const { actions } = useAnimations(clips, innerRef);

    useEffect(() => {
      const target = walking ? actions[WALK_CLIP] : actions[IDLE_CLIP];
      if (!target) return;
      target.reset().fadeIn(0.2).play();
      return () => {
        target.fadeOut(0.2);
      };
    }, [walking, actions]);

    // Apply timeScale to the clips. Done in a separate effect so dragging the
    // Leva slider doesn't restart the animation.
    useEffect(() => {
      const idle = actions[IDLE_CLIP];
      const walk = actions[WALK_CLIP];
      if (idle) idle.timeScale = idleSpeed;
      if (walk) walk.timeScale = walkSpeed;
    }, [actions, idleSpeed, walkSpeed]);

    useEffect(() => {
      scene.visible = !invisible;
    }, [scene, invisible]);

    // Play the Hit_A clip as a one-shot whenever bumpCounter ticks. The
    // underlying idle/walk action is left running; Hit blends in on top
    // for the duration of its clip and is faded back out near the end so
    // the loop seamlessly takes over again.
    const lastBumpRef = useRef(0);
    useEffect(() => {
      if (bumpCounter === 0 || bumpCounter === lastBumpRef.current) return;
      lastBumpRef.current = bumpCounter;
      const hit = actions[HIT_CLIP];
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
        <group ref={innerRef}>
          <primitive object={scene} />
        </group>
      </group>
    );
  },
);

