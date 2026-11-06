import * as THREE from 'three';

export const SIT_CLIP_NAME = 'Sit_Chair_Idle';

/** Hips height above the root bone (metres) in the Rig_Medium bind pose, which the sit pose keeps. */
export const SIT_POSE_HIP_HEIGHT = 0.4057;

/**
 * Local bone rotations (XYZ Euler degrees) of the seated pose, keyed by the readable bone name.
 * Values are absolute local rotations, not deltas on the bind pose; bones not listed keep their bind pose.
 */
const SIT_POSE_DEGREES: Record<string, readonly [number, number, number]> = {
  'upperleg.l': [90, 0, 0],
  'upperleg.r': [90, 0, 0],
  'lowerleg.l': [90, 0, 0],
  'lowerleg.r': [90, 0, 0],
  'foot.l': [-90, 0, 0],
  'foot.r': [-90, 0, 0],
  spine: [8, 0, 0],
  'upperarm.l': [-52.6, 48.4, -109.2],
  'upperarm.r': [-53.1, -52.3, 98.5],
  'lowerarm.l': [0, 0, -42],
  'lowerarm.r': [0, 0, 44],
};

const DEG = Math.PI / 180;

/** A static pose that loops: two identical keyframes on every posed bone's quaternion. */
export function createSitPoseClip(): THREE.AnimationClip {
  const tracks = Object.entries(SIT_POSE_DEGREES).map(([bone, [x, y, z]]) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'XYZ'));
    const values = [...q.toArray(), ...q.toArray()];
    // GLTFLoader strips dots from node names, and the GLB clips' tracks use the stripped form.
    return new THREE.QuaternionKeyframeTrack(
      `${THREE.PropertyBinding.sanitizeNodeName(bone)}.quaternion`,
      [0, 1],
      values,
    );
  });
  return new THREE.AnimationClip(SIT_CLIP_NAME, 1, tracks);
}
