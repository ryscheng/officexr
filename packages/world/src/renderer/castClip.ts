import * as THREE from 'three';

export const CAST_CLIP_NAME = 'Cast_Wave';
export const CAST_CLIP_DURATION = 0.8;

type Degrees = readonly [number, number, number];

/** Bone rotations are XYZ Euler degrees; the poke clip's extended arm is the pose the bolt leaves from. */
const REST: Record<string, Degrees> = {
  'upperarm.r': [-53.1, -52.3, 98.5],
  'lowerarm.r': [0, 0, 44],
};

const RAISED: Record<string, Degrees> = {
  'upperarm.r': [-70, -20, 150],
  'lowerarm.r': [0, 0, 70],
};

const EXTENDED: Record<string, Degrees> = {
  'upperarm.r': [-96.8, 7.2, -180],
  'lowerarm.r': [0, 0, 6.3],
};

const KEYS: readonly { t: number; pose: Record<string, Degrees> }[] = [
  { t: 0, pose: REST },
  { t: 0.18, pose: RAISED },
  { t: 0.32, pose: EXTENDED },
  { t: 0.55, pose: EXTENDED },
  { t: CAST_CLIP_DURATION, pose: REST },
];

const DEG = Math.PI / 180;

export function createCastClip(): THREE.AnimationClip {
  const tracks = Object.keys(REST).map((bone) => {
    const values = KEYS.flatMap(({ pose }) => {
      const [x, y, z] = pose[bone]!;
      return new THREE.Quaternion().setFromEuler(new THREE.Euler(x * DEG, y * DEG, z * DEG, 'XYZ')).toArray();
    });
    return new THREE.QuaternionKeyframeTrack(
      `${THREE.PropertyBinding.sanitizeNodeName(bone)}.quaternion`,
      KEYS.map((k) => k.t),
      values,
    );
  });
  return new THREE.AnimationClip(CAST_CLIP_NAME, CAST_CLIP_DURATION, tracks);
}
