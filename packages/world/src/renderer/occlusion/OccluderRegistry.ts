import * as THREE from 'three';
import type { Occluder } from './Occluder.ts';
import { InstancedOccluder } from './InstancedOccluder.ts';
import { isOccluderMesh, isOverheadMesh, MeshOccluder } from './MeshOccluder.ts';

const COVER_MOVE_EPSILON = 0.15;

export interface CoverProbe {
  x: number;
  feetY: number;
  z: number;
}

export class OccluderRegistry {
  private readonly occluders = new Set<Occluder>();
  private readonly lastCover = { x: 0, feetY: 0, z: 0, valid: false };

  addInstanced(mesh: THREE.InstancedMesh, count: number): () => void {
    return this.add(new InstancedOccluder(mesh, count));
  }

  addMesh(mesh: THREE.Mesh): (() => void) | null {
    if (!isOccluderMesh(mesh) && !isOverheadMesh(mesh)) return null;
    return this.add(new MeshOccluder(mesh, isOccluderMesh(mesh)));
  }

  private add(occluder: Occluder): () => void {
    this.occluders.add(occluder);
    this.lastCover.valid = false;
    return () => {
      occluder.dispose();
      this.occluders.delete(occluder);
      this.lastCover.valid = false;
    };
  }

  get size(): number {
    return this.occluders.size;
  }

  updateFades(
    camera: THREE.Vector3,
    targets: readonly THREE.Vector3[],
    dtSec: number,
    refreshMarks: boolean,
    cover: CoverProbe | null = null,
  ): void {
    if (refreshMarks) this.refreshMarks(camera, targets, cover);
    for (const o of this.occluders) o.stepFade(dtSec);
  }

  private refreshMarks(camera: THREE.Vector3, targets: readonly THREE.Vector3[], cover: CoverProbe | null): void {
    for (const o of this.occluders) {
      o.clearMarks();
      for (const t of targets) o.markCrossings(camera.x, camera.y, camera.z, t.x, t.y, t.z);
    }
    this.refreshCutaway(cover);
  }

  private refreshCutaway(cover: CoverProbe | null): void {
    const last = this.lastCover;
    if (!cover) {
      if (last.valid) this.clearCutaway();
      last.valid = false;
      return;
    }
    const dx = cover.x - last.x;
    const dz = cover.z - last.z;
    if (last.valid && Math.abs(cover.feetY - last.feetY) < 0.05 && dx * dx + dz * dz < COVER_MOVE_EPSILON * COVER_MOVE_EPSILON) return;
    last.x = cover.x;
    last.feetY = cover.feetY;
    last.z = cover.z;
    last.valid = true;
    this.clearCutaway();
    let cutY = Infinity;
    for (const o of this.occluders) cutY = Math.min(cutY, o.lowestCoverBottom(cover.x, cover.feetY, cover.z));
    if (cutY === Infinity) return;
    for (const o of this.occluders) o.markCutaway(cutY, cover.x, cover.z);
  }

  private clearCutaway(): void {
    for (const o of this.occluders) o.clearCutaway();
  }

  fadedCount(): number {
    let total = 0;
    for (const o of this.occluders) total += o.fadedCount();
    return total;
  }

  cutCount(): number {
    let total = 0;
    for (const o of this.occluders) total += o.cutCount();
    return total;
  }

  restoreAll(): void {
    this.lastCover.valid = false;
    for (const o of this.occluders) o.restore();
  }
}
