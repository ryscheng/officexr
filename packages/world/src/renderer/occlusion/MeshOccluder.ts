import * as THREE from 'three';
import type { Occluder } from './Occluder.ts';
import { createMeshGhostMaterial, disposeMaterial, setGhostOpacity } from './ghostMaterial.ts';
import { isFloorLike, segmentBoxEntry, stepFade } from './occlusionMath.ts';

export const MAX_RAYCAST_TRIANGLES = 6000;

const raycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const hits: THREE.Intersection[] = [];
const inverse = new THREE.Matrix4();

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
}

/** Whether a plain mesh can occlude: not floor-like and light enough to raycast each frame. */
export function isOccluderMesh(mesh: THREE.Mesh): boolean {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry;
  if (triangleCount(geometry) > MAX_RAYCAST_TRIANGLES) return false;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = new THREE.Box3().copy(geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld);
  return !isFloorLike(box.max.y - box.min.y);
}

/**
 * Occlusion for one plain mesh, such as a piece of a baked layout. Faded, it
 * is hidden and a sibling ghost with a one-off cloned material is drawn in its
 * place; the source material is never edited.
 */
export class MeshOccluder implements Occluder {
  private fade = 1;
  private wanted = false;
  private ghost: THREE.Mesh | null = null;
  private readonly sourceVisible: boolean;

  constructor(private readonly mesh: THREE.Mesh) {
    this.sourceVisible = mesh.visible;
    mesh.updateWorldMatrix(true, false);
  }

  private hitFraction(ax: number, ay: number, az: number, bx: number, by: number, bz: number, endInside: boolean): number {
    const geometry = this.mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    inverse.copy(this.mesh.matrixWorld).invert();
    rayOrigin.set(ax, ay, az).applyMatrix4(inverse);
    rayDirection.set(bx, by, bz).applyMatrix4(inverse);
    const entry = segmentBoxEntry(
      rayOrigin.x, rayOrigin.y, rayOrigin.z, rayDirection.x, rayDirection.y, rayDirection.z,
      box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z,
      endInside,
    );
    if (entry < 0) return -1;
    rayOrigin.set(ax, ay, az);
    rayDirection.set(bx - ax, by - ay, bz - az);
    const length = rayDirection.length();
    if (length < 1e-6) return -1;
    rayDirection.divideScalar(length);
    raycaster.set(rayOrigin, rayDirection);
    raycaster.near = 0;
    raycaster.far = length;
    hits.length = 0;
    this.mesh.raycast(raycaster, hits);
    if (hits.length === 0) return -1;
    let nearest = Infinity;
    for (const h of hits) nearest = Math.min(nearest, h.distance);
    return nearest / length;
  }

  markCrossings(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    if (this.hitFraction(ax, ay, az, bx, by, bz, false) >= 0) this.wanted = true;
  }

  firstHit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    return this.hitFraction(ax, ay, az, bx, by, bz, true);
  }

  clearMarks(): void {
    this.wanted = false;
  }

  stepFade(dtSec: number): void {
    const next = stepFade(this.fade, this.wanted, dtSec);
    if (next === this.fade) return;
    if (this.fade === 1) this.showGhost();
    this.fade = next;
    if (next === 1) {
      this.hideGhost();
    } else if (this.ghost) {
      setGhostOpacity(this.ghost.material, next);
    }
  }

  private showGhost(): void {
    if (!this.ghost) {
      const ghost = new THREE.Mesh(this.mesh.geometry, createMeshGhostMaterial(this.mesh.material));
      ghost.position.copy(this.mesh.position);
      ghost.quaternion.copy(this.mesh.quaternion);
      ghost.scale.copy(this.mesh.scale);
      ghost.castShadow = this.mesh.castShadow;
      ghost.receiveShadow = this.mesh.receiveShadow;
      ghost.raycast = () => undefined;
      this.mesh.parent?.add(ghost);
      this.ghost = ghost;
    }
    this.ghost.visible = true;
    this.mesh.visible = false;
  }

  private hideGhost(): void {
    if (this.ghost) this.ghost.visible = false;
    this.mesh.visible = this.sourceVisible;
  }

  restore(): void {
    this.fade = 1;
    this.wanted = false;
    this.hideGhost();
  }

  dispose(): void {
    this.restore();
    if (this.ghost) {
      this.ghost.parent?.remove(this.ghost);
      disposeMaterial(this.ghost.material);
      this.ghost = null;
    }
  }
}
