import { useEffect } from 'react';
import { useControls } from 'leva';
import type { Actions } from '@officexr/sdk';

export interface AnimationPanelValues {
  idleSpeed: number;
  walkSpeed: number;
  runSpeed: number;
  turnSpeed: number;
  playerSpeed: number;
  runMultiplier: number;
  movementBlockThreshold: number;
}

/**
 * Leva "Animation" panel. Owns the character-movement + animation
 * knobs and mirrors them into the SDK's world settings so peers
 * observe identical values.
 *
 * Returns the raw panel values for any caller that also needs them
 * locally (today: nobody — the renderer reads `worldSettings` off
 * the store).
 */
export function useAnimationPanel(actions: Actions): AnimationPanelValues {
  const values = useControls('Animation', {
    idleSpeed: { value: 1, min: 0.1, max: 3, step: 0.05 },
    walkSpeed: { value: 1, min: 0.1, max: 10, step: 0.05 },
    runSpeed: {
      value: 1,
      min: 0.1,
      max: 10,
      step: 0.05,
      label: 'run anim speed',
    },
    turnSpeed: {
      value: 16,
      min: 1,
      max: 60,
      step: 0.5,
      label: 'turn speed (rad/s)',
    },
    playerSpeed: {
      value: 3,
      min: 0.5,
      max: 15,
      step: 0.1,
      label: 'walk speed (m/s)',
    },
    runMultiplier: {
      value: 2,
      min: 1,
      max: 6,
      step: 0.1,
      label: 'run × walk',
    },
    movementBlockThreshold: {
      value: 0.9,
      min: 0,
      max: 1,
      step: 0.01,
      label: 'block threshold',
    },
  });

  useEffect(() => {
    actions.setWorldSettings({
      playerSpeed: values.playerSpeed,
      runSpeedMultiplier: values.runMultiplier,
      walkAnimSpeed: values.walkSpeed,
      runAnimSpeed: values.runSpeed,
      idleAnimSpeed: values.idleSpeed,
      turnSpeed: values.turnSpeed,
      movementBlockThreshold: values.movementBlockThreshold,
    });
  }, [
    actions,
    values.playerSpeed,
    values.runMultiplier,
    values.walkSpeed,
    values.runSpeed,
    values.idleSpeed,
    values.turnSpeed,
    values.movementBlockThreshold,
  ]);

  return values;
}
