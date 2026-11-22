import * as THREE from 'three';
import type { Occluder } from './Occluder.ts';
import { InstancedOccluder } from './InstancedOccluder.ts';
import { isOccluderMesh, isOverheadMesh, MeshOccluder } from './MeshOccluder.ts';

export interface CoverProbe {
  x: number;
  feetY: number;
  z: number;
}

export class OccluderRegistry {
  private readonly occluders = new Set<Occluder>();

  addInstanced(mesh: THREE.InstancedMesh, count: number): () => void {
    return this.add(new InstancedOccluder(mesh, count));
  }

  addMesh(mesh: THREE.Mesh): (() => void) | null {
    if (!isOccluderMesh(mesh) && !isOverheadMesh(mesh)) return null;
    return this.add(new MeshOccluder(mesh, isOccluderMesh(mesh)));
  }

  private add(occluder: Occluder): () => void {
    this.occluders.add(occluder);
    return () => {
      occluder.dispose();
      this.occluders.delete(occluder);
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
    if (!cover) return;
    let cutY = Infinity;
    for (const o of this.occluders) cutY = Math.min(cutY, o.lowestCoverBottom(cover.x, cover.feetY, cover.z));
    if (cutY === Infinity) return;
    for (const o of this.occluders) o.markCutaway(cutY, cover.x, cover.z);
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
    for (const o of this.occluders) o.restore();
  }
}
