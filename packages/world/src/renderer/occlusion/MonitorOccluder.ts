import * as THREE from 'three';
import type { Occluder } from './Occluder.ts';
import { segmentBoxEntry, stepFade } from './occlusionMath.ts';

const inverse = new THREE.Matrix4();
const from = new THREE.Vector3();
const to = new THREE.Vector3();

// Fades through the materials' own opacity: a ghost clone would freeze the emissive level the screen shows.
export class MonitorOccluder implements Occluder {
  private fade = 1;
  private wanted = false;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly bounds: THREE.Box3,
    private readonly meshes: readonly THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[],
  ) {}

  markCrossings(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    this.root.updateWorldMatrix(true, false);
    inverse.copy(this.root.matrixWorld).invert();
    from.set(ax, ay, az).applyMatrix4(inverse);
    to.set(bx, by, bz).applyMatrix4(inverse);
    const { min, max } = this.bounds;
    if (segmentBoxEntry(from.x, from.y, from.z, to.x, to.y, to.z, min.x, min.y, min.z, max.x, max.y, max.z) >= 0) {
      this.wanted = true;
    }
  }

  fadedCount(): number {
    return this.fade < 1 ? 1 : 0;
  }

  clearMarks(): void {
    this.wanted = false;
  }

  stepFade(dtSec: number): void {
    const next = stepFade(this.fade, this.wanted, dtSec);
    if (next !== this.fade) this.apply(next);
  }

  private apply(fade: number): void {
    this.fade = fade;
    for (const mesh of this.meshes) {
      mesh.material.opacity = fade;
      mesh.material.depthWrite = fade === 1;
      mesh.castShadow = fade === 1;
    }
  }

  restore(): void {
    this.wanted = false;
    this.apply(1);
  }

  dispose(): void {
    this.restore();
  }
}
