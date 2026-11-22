import * as THREE from 'three';
import type { Occluder } from './Occluder.ts';
import { createMeshGhostMaterial, disposeMaterial, setGhostOpacity } from './ghostMaterial.ts';
import { isAboveCutPlane, isOverheadCover, isRoofName, ROOF_REACH, withinCutawayRadius } from './cutawayMath.ts';
import { ANCHOR_MARGIN, ANCHOR_MAX_RADIUS, fadeTarget, isFloorLike, segmentBoxEntry, stepToward, type Anchor } from './occlusionMath.ts';

export const MAX_RAYCAST_TRIANGLES = 6000;
const MIN_OVERHEAD_BOTTOM = 1.5;

const raycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const hits: THREE.Intersection[] = [];
const inverse = new THREE.Matrix4();

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
}

function castHits(mesh: THREE.Mesh, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  rayOrigin.set(ax, ay, az);
  rayDirection.set(bx - ax, by - ay, bz - az);
  const length = rayDirection.length();
  if (length < 1e-6) return false;
  rayDirection.divideScalar(length);
  raycaster.set(rayOrigin, rayDirection);
  raycaster.near = 0;
  raycaster.far = length;
  hits.length = 0;
  mesh.raycast(raycaster, hits);
  return hits.length > 0;
}

export function isOccluderMesh(mesh: THREE.Mesh): boolean {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry;
  if (triangleCount(geometry) > MAX_RAYCAST_TRIANGLES) return false;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = new THREE.Box3().copy(geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld);
  return !isFloorLike(box.max.y - box.min.y);
}

export function isOverheadMesh(mesh: THREE.Mesh): boolean {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = new THREE.Box3().copy(geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld);
  return box.min.y > MIN_OVERHEAD_BOTTOM;
}

export class MeshOccluder implements Occluder {
  private fade = 1;
  private wanted = false;
  private cut = false;
  private anchored = false;
  private readonly named: boolean;
  private readonly bounds = new THREE.Box3();
  private readonly boundsCentre = new THREE.Vector3();
  private readonly boundsRadius: number;
  private ghost: THREE.Mesh | null = null;
  private readonly sourceVisible: boolean;

  constructor(private readonly mesh: THREE.Mesh, private readonly fadeable = true) {
    this.sourceVisible = mesh.visible;
    mesh.updateWorldMatrix(true, false);
    this.named = isRoofName(mesh.name);
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    this.bounds.copy(geometry.boundingBox as THREE.Box3).applyMatrix4(mesh.matrixWorld);
    this.bounds.getCenter(this.boundsCentre);
    this.boundsRadius = this.bounds.getSize(new THREE.Vector3()).length() / 2;
  }

  private blocks(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const geometry = this.mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox as THREE.Box3;
    inverse.copy(this.mesh.matrixWorld).invert();
    rayOrigin.set(ax, ay, az).applyMatrix4(inverse);
    rayDirection.set(bx, by, bz).applyMatrix4(inverse);
    const entry = segmentBoxEntry(
      rayOrigin.x, rayOrigin.y, rayOrigin.z, rayDirection.x, rayDirection.y, rayDirection.z,
      box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z,
    );
    if (entry < 0) return false;
    if (castHits(this.mesh, ax, ay, az, bx, by, bz)) return true;
    // From inside the mesh the front faces point away, so look back from the target.
    return entry === 0 && castHits(this.mesh, bx, by, bz, ax, ay, az);
  }

  setIgnored(): void {}

  private containsAnchor(a: Anchor): boolean {
    if (this.boundsRadius > ANCHOR_MAX_RADIUS) return false;
    const b = this.bounds;
    const m = ANCHOR_MARGIN;
    return (
      a.x >= b.min.x - m && a.x <= b.max.x + m &&
      a.y >= b.min.y - m && a.y <= b.max.y + m &&
      a.z >= b.min.z - m && a.z <= b.max.z + m
    );
  }

  setAnchor(anchor: Anchor): void {
    this.anchored = anchor.active && this.containsAnchor(anchor);
  }

  blocksSegment(ax: number, ay: number, az: number, bx: number, by: number, bz: number, _ignore: ReadonlySet<string>, anchor: Anchor): boolean {
    if (!this.fadeable || (anchor.active && this.containsAnchor(anchor))) return false;
    return this.blocks(ax, ay, az, bx, by, bz);
  }

  markCrossings(ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
    if (this.fadeable && !this.anchored && this.blocks(ax, ay, az, bx, by, bz)) this.wanted = true;
  }

  lowestCoverBottom(px: number, feetY: number, pz: number): number {
    if (this.anchored) return Infinity;
    const bottom = this.bounds.min.y;
    if (!isOverheadCover(bottom, feetY, this.named)) return Infinity;
    if (px < this.bounds.min.x || px > this.bounds.max.x || pz < this.bounds.min.z || pz > this.bounds.max.z) return Infinity;
    const headY = feetY + 1;
    inverse.copy(this.mesh.matrixWorld).invert();
    rayOrigin.set(px, headY, pz).applyMatrix4(inverse);
    rayDirection.set(px, headY + ROOF_REACH, pz).applyMatrix4(inverse);
    const geometry = this.mesh.geometry;
    const box = geometry.boundingBox as THREE.Box3;
    const entry = segmentBoxEntry(
      rayOrigin.x, rayOrigin.y, rayOrigin.z, rayDirection.x, rayDirection.y, rayDirection.z,
      box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z,
    );
    return entry >= 0 ? bottom : Infinity;
  }

  markCutaway(cutY: number, px: number, pz: number): void {
    if (this.anchored || !isAboveCutPlane(this.bounds.min.y, cutY)) return;
    if (withinCutawayRadius(this.boundsCentre.x - px, this.boundsCentre.z - pz, this.boundsRadius)) this.cut = true;
  }

  fadedCount(): number {
    return this.fade < 1 ? 1 : 0;
  }

  cutCount(): number {
    return this.cut ? 1 : 0;
  }

  clearMarks(): void {
    this.wanted = false;
  }

  clearCutaway(): void {
    this.cut = false;
  }

  stepFade(dtSec: number): void {
    const next = stepToward(this.fade, fadeTarget(this.wanted, this.cut), dtSec);
    if (next === this.fade) return;
    if (this.fade === 1) this.showGhost();
    this.fade = next;
    if (next === 1) {
      this.hideGhost();
    } else if (this.ghost) {
      setGhostOpacity(this.ghost.material, next);
      this.ghost.visible = next > 0;
    }
  }

  private showGhost(): void {
    if (!this.ghost) {
      const ghost = new THREE.Mesh(this.mesh.geometry, createMeshGhostMaterial(this.mesh.material));
      ghost.position.copy(this.mesh.position);
      ghost.quaternion.copy(this.mesh.quaternion);
      ghost.scale.copy(this.mesh.scale);
      ghost.castShadow = false;
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
    this.cut = false;
    this.anchored = false;
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
