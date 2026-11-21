import * as THREE from 'three';

const EPSILON = 1e-6;
const HIPS = 'hips';

type Channel = 'position' | 'scale';

const splitTrackName = (name: string): [string, string] => {
  const dot = name.lastIndexOf('.');
  return [name.slice(0, dot), name.slice(dot + 1)];
};

function hipsRatio(rig: THREE.Object3D, character: THREE.Object3D): number {
  const rigHips = rig.getObjectByName(HIPS)?.position.length() ?? 0;
  const charHips = character.getObjectByName(HIPS)?.position.length() ?? 0;
  return rigHips > EPSILON && charHips > EPSILON ? charHips / rigHips : 1;
}

function rebasePositions(track: THREE.KeyframeTrack, rigBind: THREE.Vector3, charBind: THREE.Vector3, ratio: number): THREE.KeyframeTrack {
  const values = Float32Array.from(track.values);
  for (let i = 0; i < values.length; i += 3) {
    values[i] = charBind.x + (values[i]! - rigBind.x) * ratio;
    values[i + 1] = charBind.y + (values[i + 1]! - rigBind.y) * ratio;
    values[i + 2] = charBind.z + (values[i + 2]! - rigBind.z) * ratio;
  }
  return new THREE.VectorKeyframeTrack(track.name, track.times, values);
}

function rebaseScales(track: THREE.KeyframeTrack, rigBind: THREE.Vector3, charBind: THREE.Vector3): THREE.KeyframeTrack {
  const values = Float32Array.from(track.values);
  const factor = [charBind.x / (rigBind.x || 1), charBind.y / (rigBind.y || 1), charBind.z / (rigBind.z || 1)];
  for (let i = 0; i < values.length; i += 3) {
    values[i] = values[i]! * factor[0]!;
    values[i + 1] = values[i + 1]! * factor[1]!;
    values[i + 2] = values[i + 2]! * factor[2]!;
  }
  return new THREE.VectorKeyframeTrack(track.name, track.times, values);
}

function bindOf(root: THREE.Object3D, bone: string, channel: Channel): THREE.Vector3 | null {
  const node = root.getObjectByName(bone);
  return node ? node[channel] : null;
}

function differs(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return a.distanceToSquared(b) > EPSILON;
}

/**
 * Expresses a clip authored for the `rig` skeleton in the proportions of `character`: each `.position`
 * track keeps its motion as an offset from the rig's bind translation, scaled by the bone's length ratio
 * and applied to the character's own bind translation; `.scale` tracks are rebased the same way.
 * Quaternion tracks are untouched. Returns `clip` itself when the two skeletons already agree.
 */
export function retargetClip(clip: THREE.AnimationClip, rig: THREE.Object3D, character: THREE.Object3D): THREE.AnimationClip {
  const fallbackRatio = hipsRatio(rig, character);
  let changed = false;
  const tracks = clip.tracks.map((track) => {
    const [bone, channel] = splitTrackName(track.name);
    if (channel !== 'position' && channel !== 'scale') return track;
    const rigBind = bindOf(rig, bone, channel);
    const charBind = bindOf(character, bone, channel);
    if (!rigBind || !charBind || !differs(rigBind, charBind)) return track;
    changed = true;
    if (channel === 'scale') return rebaseScales(track, rigBind, charBind);
    const rigLength = rigBind.length();
    const ratio = rigLength > EPSILON ? charBind.length() / rigLength : fallbackRatio;
    return rebasePositions(track, rigBind, charBind, ratio);
  });
  return changed ? new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode) : clip;
}

const retargeted = new WeakMap<THREE.Object3D, WeakMap<THREE.AnimationClip, THREE.AnimationClip>>();

/** {@link retargetClip}, computed once per character model and clip. */
export function retargetClipCached(clip: THREE.AnimationClip, rig: THREE.Object3D, character: THREE.Object3D): THREE.AnimationClip {
  let perClip = retargeted.get(character);
  if (!perClip) {
    perClip = new WeakMap();
    retargeted.set(character, perClip);
  }
  let out = perClip.get(clip);
  if (!out) {
    out = retargetClip(clip, rig, character);
    perClip.set(clip, out);
  }
  return out;
}
