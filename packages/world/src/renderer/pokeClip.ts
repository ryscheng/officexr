import * as THREE from 'three';

export const POKE_CLIP_NAME = 'Poke_Point';
export const POKE_CLIP_DURATION = 0.6;

type Degrees = readonly [number, number, number];

/** Local bone rotations (XYZ Euler degrees) of the arm at rest, as `Idle_A` holds them on its first frame. */
const REST: Record<string, Degrees> = {
  'upperarm.r': [-53.1, -52.3, 98.5],
  'lowerarm.r': [0, 0, 44],
};

/** The arm stretched straight out in front, the way a poke reaches. */
const EXTENDED: Record<string, Degrees> = {
  'upperarm.r': [-12, -88, 98.5],
  'lowerarm.r': [0, 0, 4],
};

const KEYS: readonly { t: number; pose: Record<string, Degrees> }[] = [
  { t: 0, pose: REST },
  { t: 0.14, pose: EXTENDED },
  { t: 0.34, pose: EXTENDED },
  { t: POKE_CLIP_DURATION, pose: REST },
];

const DEG = Math.PI / 180;

/** A one-shot arm-only clip: reach out, hold the point, and return. Other bones keep whatever else is playing. */
export function createPokeClip(): THREE.AnimationClip {
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
  return new THREE.AnimationClip(POKE_CLIP_NAME, POKE_CLIP_DURATION, tracks);
}
