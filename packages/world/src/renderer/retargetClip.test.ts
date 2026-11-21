import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { retargetClip, retargetClipCached } from './retargetClip.ts';

function skeleton(k: number): THREE.Object3D {
  const root = new THREE.Bone();
  root.name = 'root';
  const hips = new THREE.Bone();
  hips.name = 'hips';
  hips.position.set(0, 0.4 * k, 0);
  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.set(0, 0.2 * k, 0);
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.set(0, 0.3 * k, 0);
  head.scale.set(1, 1, 1);
  root.add(hips);
  hips.add(spine);
  spine.add(head);
  return root;
}

function clip(): THREE.AnimationClip {
  return new THREE.AnimationClip('Idle', 1, [
    new THREE.VectorKeyframeTrack('hips.position', [0, 1], [0, 0.38, 0, 0, 0.4, 0]),
    new THREE.VectorKeyframeTrack('spine.position', [0, 1], [0, 0.2, 0, 0, 0.2, 0]),
    new THREE.VectorKeyframeTrack('head.scale', [0, 1], [1, 1, 1, 1, 1, 1]),
    new THREE.QuaternionKeyframeTrack('spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
  ]);
}

const headHeight = (character: THREE.Object3D, c: THREE.AnimationClip, t: number): number => {
  const mixer = new THREE.AnimationMixer(character);
  mixer.clipAction(c).play();
  mixer.setTime(t);
  character.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(character.getObjectByName('head')!.matrixWorld).y;
};

describe('retargetClip', () => {
  it('returns the same clip when the skeletons agree', () => {
    const c = clip();
    expect(retargetClip(c, skeleton(1), skeleton(1))).toBe(c);
  });

  it('keeps quaternion tracks and rewrites translation tracks on a larger skeleton', () => {
    const c = clip();
    const out = retargetClip(c, skeleton(1), skeleton(2.5));
    const byName = (name: string) => out.tracks.find((t) => t.name === name)!;
    expect(byName('spine.quaternion')).toBe(c.tracks[3]);
    expect(Array.from(byName('spine.position').values).slice(0, 3)).toEqual([0, 0.5, 0]);
    expect(byName('hips.position').values[1]).toBeCloseTo(1 - 0.02 * 2.5);
    expect(byName('hips.position').values[4]).toBeCloseTo(1);
  });

  it('rebases scale tracks onto the character bind scale', () => {
    const character = skeleton(2);
    character.getObjectByName('head')!.scale.set(2, 2, 2);
    const out = retargetClip(clip(), skeleton(1), character);
    expect(Array.from(out.tracks.find((t) => t.name === 'head.scale')!.values).slice(0, 3)).toEqual([2, 2, 2]);
  });

  it('keeps the posed height in step with the bind height', () => {
    for (const k of [1, 2.5]) {
      const character = skeleton(k);
      const bind = headHeight(character, new THREE.AnimationClip('empty', 1, []), 0);
      const posed = headHeight(skeleton(k), retargetClip(clip(), skeleton(1), skeleton(k)), 0.5);
      expect(Math.abs(posed - bind) / bind).toBeLessThan(0.05);
    }
    const unfixed = headHeight(skeleton(2.5), clip(), 0.5);
    expect(unfixed).toBeLessThan(0.6 * headHeight(skeleton(2.5), new THREE.AnimationClip('empty', 1, []), 0));
  });

  it('computes each character and clip once', () => {
    const c = clip();
    const rig = skeleton(1);
    const character = skeleton(2);
    expect(retargetClipCached(c, rig, character)).toBe(retargetClipCached(c, rig, character));
  });
});
