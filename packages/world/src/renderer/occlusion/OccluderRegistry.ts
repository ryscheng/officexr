import * as THREE from 'three';
import type { Occluder } from './Occluder.ts';
import { InstancedOccluder } from './InstancedOccluder.ts';
import { isOccluderMesh, MeshOccluder } from './MeshOccluder.ts';

/**
 * The static world geometry that can hide the player. Renderers add what
 * they draw; the occlusion controller queries it. Never holds floors, other
 * players or the self player.
 */
export class OccluderRegistry {
  private readonly occluders = new Set<Occluder>();

  addInstanced(mesh: THREE.InstancedMesh, count: number): () => void {
    return this.add(new InstancedOccluder(mesh, count));
  }

  addMesh(mesh: THREE.Mesh): (() => void) | null {
    if (!isOccluderMesh(mesh)) return null;
    return this.add(new MeshOccluder(mesh));
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

  /** Marks everything crossing any of the segments from the camera, then steps all fades. */
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

  /** Fraction along a->b of the nearest entry into any occluder, or -1. */
  firstHit(a: THREE.Vector3, b: THREE.Vector3): number {
    let best = -1;
    for (const o of this.occluders) {
      const t = o.firstHit(a.x, a.y, a.z, b.x, b.y, b.z);
      if (t >= 0 && (best < 0 || t < best)) best = t;
    }
    return best;
  }

  restoreAll(): void {
    for (const o of this.occluders) o.restore();
  }
}
