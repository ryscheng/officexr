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
}

/**
 * Renders one Adventurer GLB with idle/walk animations applied. The position
 * and yaw of the wrapping <group> is mutated externally each frame (avoids
 * per-frame React re-renders).
 */
export const Adventurer = React.forwardRef<THREE.Group, AdventurerProps>(
  function Adventurer({ character, walking, invisible }, ref) {
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
      const target = walking ? actions['Walking_C'] : actions['Idle_A'];
      if (!target) return;
      target.reset().fadeIn(0.2).play();
      return () => {
        target.fadeOut(0.2);
      };
    }, [walking, actions]);

    useEffect(() => {
      scene.visible = !invisible;
    }, [scene, invisible]);

    return (
      <group ref={ref}>
        <group ref={innerRef}>
          <primitive object={scene} />
        </group>
      </group>
    );
  },
);

