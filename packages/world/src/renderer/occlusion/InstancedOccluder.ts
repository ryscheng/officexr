import * as THREE from 'three';
import type { Occluder } from './Occluder.ts';
import { createInstancedGhostMaterial, disposeMaterial } from './ghostMaterial.ts';
import { hasScreenGlow } from '../screenGlowShader.ts';
import { isOverheadCover, isAboveCutPlane, isRoofName, ROOF_REACH, withinCutawayRadius } from './cutawayMath.ts';
import { fadeTarget, isFloorLike, segmentBoxEntry, stepToward } from './occlusionMath.ts';

const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const scratchMatrix = new THREE.Matrix4();
const scratchInverse = new THREE.Matrix4();
const corner = new THREE.Vector3();

// Faded instances move to a ghost mesh so the source material is never edited; it casts no shadow, so the player is not darkened.
export class InstancedOccluder implements Occluder {
  private readonly count: number;
  private readonly source: Float32Array;
  private readonly inverse: Float32Array;
  private readonly centre: Float32Array;
  private readonly radius: Float32Array;
  private readonly solid: Uint8Array;
  private readonly bottom: Float32Array;
  private readonly named: boolean;
  private readonly fade: Float32Array;
  private readonly cut = new Set<number>();
  private readonly wanted = new Set<number>();
  private readonly active = new Set<number>();
  private readonly ghostOf: number[] = [];
  private readonly slotOf = new Map<number, number>();
  private readonly min: THREE.Vector3;
  private readonly max: THREE.Vector3;
  private ghost: THREE.InstancedMesh | null = null;
  private ghostMaterial: THREE.Material | null = null;

  constructor(private readonly mesh: THREE.InstancedMesh, count = mesh.count) {
    this.count = count;
    mesh.updateWorldMatrix(true, false);
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    this.min = box.min.clone();
    this.max = box.max.clone();
    const localRadius = box.getSize(new THREE.Vector3()).length() / 2;
    const localCentre = box.getCenter(new THREE.Vector3());
    this.source = new Float32Array(mesh.instanceMatrix.array.slice(0, count * 16));
    this.inverse = new Float32Array(count * 16);
    this.centre = new Float32Array(count * 3);
    this.radius = new Float32Array(count);
    this.solid = new Uint8Array(count);
    this.bottom = new Float32Array(count);
    this.named = isRoofName(mesh.userData?.kindId) || isRoofName(mesh.name);
    this.fade = new Float32Array(count).fill(1);
    const centre = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      scratchMatrix.fromArray(this.source, i * 16).premultiply(mesh.matrixWorld);
      scratchInverse.copy(scratchMatrix).invert();
      scratchInverse.toArray(this.inverse, i * 16);
      centre.copy(localCentre).applyMatrix4(scratchMatrix);
      this.centre[i * 3] = centre.x;
      this.centre[i * 3 + 1] = centre.y;
      this.centre[i * 3 + 2] = centre.z;
      const e = scratchMatrix.elements;
      const sx = Math.hypot(e[0], e[1], e[2]);
      const sy = Math.hypot(e[4], e[5], e[6]);
      const sz = Math.hypot(e[8], e[9], e[10]);
      this.radius[i] = localRadius * Math.max(sx, sy, sz);
      this.bottom[i] = this.worldBottom(scratchMatrix);
      this.solid[i] = isFloorLike((box.max.y - box.min.y) * sy) ? 0 : 1;
    }
  }

  private worldBottom(matrix: THREE.Matrix4): number {
    let bottom = Infinity;
    for (let c = 0; c < 8; c++) {
      corner.set(c & 1 ? this.max.x : this.min.x, c & 2 ? this.max.y : this.min.y, c & 4 ? this.max.z : this.min.z);
      bottom = Math.min(bottom, corner.applyMatrix4(matrix).y);
    }
    return bottom;
  }

  private localSegment(i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    const e = this.inverse;
    const o = i * 16;
    const lax = e[o] * ax + e[o + 4] * ay + e[o + 8] * az + e[o + 12];
    const lay = e[o + 1] * ax + e[o + 5] * ay + e[o + 9] * az + e[o + 13];
    const laz = e[o + 2] * ax + e[o + 6] * ay + e[o + 10] * az + e[o + 14];
    const lbx = e[o] * bx + e[o + 4] * by + e[o + 8] * bz + e[o + 12];
    const lby = e[o + 1] * bx + e[o + 5] * by + e[o + 9] * bz + e[o + 13];
    const lbz = e[o + 2] * bx + e[o + 6] * by + e[o + 10] * bz + e[o + 14];
    return segmentBoxEntry(
      lax, lay, laz, lbx, lby, lbz,
      this.min.x, this.min.y, this.min.z, this.max.x, this.max.y, this.max.z,
    );
  }

  private entry(i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    if (!this.solid[i]) return -1;
    const r = this.radius[i];
    const cx = this.centre[i * 3];
    const cz = this.centre[i * 3 + 2];
    if (Math.max(ax, bx) < cx - r || Math.min(ax, bx) > cx + r) return -1;
    if (Math.max(az, bz) < cz - r || Math.min(az, bz) > cz + r) return -1;
    return this.localSegment(i, ax, ay, az, bx, by, bz);
  }

  markCrossings(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.entry(i, ax, ay, az, bx, by, bz) >= 0) this.wanted.add(i);
    }
  }

  lowestCoverBottom(px: number, feetY: number, pz: number): number {
    let lowest = Infinity;
    const headY = feetY + 1;
    for (let i = 0; i < this.count; i++) {
      const bottom = this.bottom[i];
      if (bottom >= lowest || !isOverheadCover(bottom, feetY, this.named)) continue;
      const r = this.radius[i];
      if (Math.abs(px - this.centre[i * 3]) > r || Math.abs(pz - this.centre[i * 3 + 2]) > r) continue;
      if (this.localSegment(i, px, headY, pz, px, headY + ROOF_REACH, pz) >= 0) lowest = bottom;
    }
    return lowest;
  }

  markCutaway(cutY: number, px: number, pz: number): void {
    for (let i = 0; i < this.count; i++) {
      if (!isAboveCutPlane(this.bottom[i], cutY)) continue;
      if (withinCutawayRadius(this.centre[i * 3] - px, this.centre[i * 3 + 2] - pz, this.radius[i])) this.cut.add(i);
    }
  }

  fadedCount(): number {
    return this.ghostOf.length;
  }

  cutCount(): number {
    return this.cut.size;
  }

  clearMarks(): void {
    this.wanted.clear();
  }

  clearCutaway(): void {
    this.cut.clear();
  }

  stepFade(dtSec: number): void {
    for (const i of this.wanted) this.active.add(i);
    for (const i of this.cut) this.active.add(i);
    if (this.active.size === 0) return;
    let colourDirty = false;
    for (const i of this.active) {
      if (this.fade[i] < 1) colourDirty = this.syncScreenGlow(i) || colourDirty;
      const next = stepToward(this.fade[i], fadeTarget(this.wanted.has(i), this.cut.has(i)), dtSec);
      if (next === this.fade[i]) {
        if (next === 1) this.active.delete(i);
        continue;
      }
      if (this.fade[i] === 1) this.moveToGhost(i);
      this.fade[i] = next;
      if (next === 1) {
        this.moveFromGhost(i);
        this.active.delete(i);
      } else {
        const ghost = this.ghost as THREE.InstancedMesh;
        (ghost.instanceColor as THREE.InstancedBufferAttribute).array[(this.slotOf.get(i) as number) * 3] = next;
        colourDirty = true;
      }
    }
    if (colourDirty && this.ghost?.instanceColor) this.ghost.instanceColor.needsUpdate = true;
  }

  // Glow lives in the source's instanceColor (y: level, z: lit face); a ghost slot mirrors it so a faded screen stays lit.
  private syncScreenGlow(i: number): boolean {
    const source = this.mesh.instanceColor;
    const target = this.ghost?.instanceColor;
    const slot = this.slotOf.get(i);
    if (!source || !target || slot === undefined) return false;
    const s = source.array;
    const t = target.array;
    const changed = t[slot * 3 + 1] !== s[i * 3 + 1] || t[slot * 3 + 2] !== s[i * 3 + 2];
    t[slot * 3 + 1] = s[i * 3 + 1];
    t[slot * 3 + 2] = s[i * 3 + 2];
    return changed;
  }

  private ensureGhost(): THREE.InstancedMesh {
    if (this.ghost) return this.ghost;
    const base = this.mesh.material as THREE.Material;
    this.ghostMaterial = createInstancedGhostMaterial(base);
    const ghost = new THREE.InstancedMesh(this.mesh.geometry, this.ghostMaterial, this.count);
    ghost.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.count * 3).fill(1), 3);
    if (hasScreenGlow(base)) {
      const colours = ghost.instanceColor.array;
      for (let i = 0; i < this.count; i++) colours[i * 3 + 1] = colours[i * 3 + 2] = 0;
    }
    ghost.castShadow = false;
    ghost.receiveShadow = this.mesh.receiveShadow;
    ghost.raycast = () => undefined;
    ghost.frustumCulled = false;
    ghost.count = 0;
    ghost.position.copy(this.mesh.position);
    ghost.quaternion.copy(this.mesh.quaternion);
    ghost.scale.copy(this.mesh.scale);
    this.mesh.parent?.add(ghost);
    this.ghost = ghost;
    return ghost;
  }

  private moveToGhost(i: number): void {
    const ghost = this.ensureGhost();
    const slot = this.ghostOf.length;
    this.ghostOf.push(i);
    this.slotOf.set(i, slot);
    scratchMatrix.fromArray(this.source, i * 16);
    ghost.setMatrixAt(slot, scratchMatrix);
    ghost.count = this.ghostOf.length;
    ghost.instanceMatrix.needsUpdate = true;
    if (this.syncScreenGlow(i) && ghost.instanceColor) ghost.instanceColor.needsUpdate = true;
    this.mesh.setMatrixAt(i, ZERO_MATRIX);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private moveFromGhost(i: number): void {
    const ghost = this.ghost as THREE.InstancedMesh;
    const slot = this.slotOf.get(i) as number;
    const last = this.ghostOf.length - 1;
    if (slot !== last) {
      const moved = this.ghostOf[last];
      this.ghostOf[slot] = moved;
      this.slotOf.set(moved, slot);
      ghost.getMatrixAt(last, scratchMatrix);
      ghost.setMatrixAt(slot, scratchMatrix);
      const colours = (ghost.instanceColor as THREE.InstancedBufferAttribute).array;
      colours[slot * 3] = colours[last * 3];
      colours[slot * 3 + 1] = colours[last * 3 + 1];
      colours[slot * 3 + 2] = colours[last * 3 + 2];
      ghost.instanceMatrix.needsUpdate = true;
      (ghost.instanceColor as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    this.ghostOf.pop();
    this.slotOf.delete(i);
    ghost.count = this.ghostOf.length;
    scratchMatrix.fromArray(this.source, i * 16);
    this.mesh.setMatrixAt(i, scratchMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  restore(): void {
    for (const i of [...this.slotOf.keys()]) this.moveFromGhost(i);
    this.fade.fill(1);
    this.active.clear();
    this.wanted.clear();
    this.cut.clear();
  }

  dispose(): void {
    this.restore();
    if (this.ghost) {
      this.ghost.parent?.remove(this.ghost);
      this.ghost.dispose();
    }
    if (this.ghostMaterial) disposeMaterial(this.ghostMaterial);
    this.ghost = null;
    this.ghostMaterial = null;
  }
}
