import * as THREE from 'three';
import type { Occluder } from './Occluder.ts';
import { InstancedOccluder } from './InstancedOccluder.ts';
import { isOccluderMesh, MeshOccluder } from './MeshOccluder.ts';

export class OccluderRegistry {
  private readonly occluders = new Set<Occluder>();

  addInstanced(mesh: THREE.InstancedMesh, count: number): () => void {
    return this.add(new InstancedOccluder(mesh, count));
  }

  addMesh(mesh: THREE.Mesh): (() => void) | null {
    if (!isOccluderMesh(mesh)) return null;
    return this.add(new MeshOccluder(mesh));
  }

  addOccluder(occluder: Occluder): () => void {
    return this.add(occluder);
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
  ): void {
    for (const o of this.occluders) {
      if (refreshMarks) {
        o.clearMarks();
        for (const t of targets) o.markCrossings(camera.x, camera.y, camera.z, t.x, t.y, t.z);
      }
      o.stepFade(dtSec);
    }
  }

    fadedCount(): number {
    let total = 0;
    for (const o of this.occluders) total += o.fadedCount();
    return total;
  }

  restoreAll(): void {
    for (const o of this.occluders) o.restore();
  }
}
