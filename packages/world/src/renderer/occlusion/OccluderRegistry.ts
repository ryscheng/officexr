import * as THREE from 'three';
import type { Occluder } from './Occluder.ts';
import { InstancedOccluder } from './InstancedOccluder.ts';
import { createAnchor, type Anchor } from './occlusionMath.ts';
import { isOccluderMesh, isOverheadMesh, MeshOccluder } from './MeshOccluder.ts';

const COVER_MOVE_EPSILON = 0.15;
const ANCHOR_MOVE_EPSILON = 0.05;

export interface CoverProbe {
  x: number;
  feetY: number;
  z: number;
}

export class OccluderRegistry {
  private readonly occluders = new Set<Occluder>();
  private readonly lastCover = { x: 0, feetY: 0, z: 0, valid: false };
  private readonly occupied = new Set<string>();
  private readonly selfAnchor = createAnchor();
  private readonly probeIgnore = new Set<string>();
  private readonly suppressed = new Set<string>();

  addInstanced(mesh: THREE.InstancedMesh, count: number, ids?: readonly string[]): () => void {
    return this.add(new InstancedOccluder(mesh, count, ids));
  }

  addMesh(mesh: THREE.Mesh): (() => void) | null {
    if (!isOccluderMesh(mesh) && !isOverheadMesh(mesh)) return null;
    return this.add(new MeshOccluder(mesh, isOccluderMesh(mesh)));
  }

  private add(occluder: Occluder): () => void {
    occluder.setIgnored(this.occupied);
    occluder.setAnchor(this.selfAnchor);
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

  setOccupied(ids: ReadonlySet<string>): void {
    let same = ids.size === this.occupied.size;
    if (same) {
      for (const id of ids) {
        if (!this.occupied.has(id)) {
          same = false;
          break;
        }
      }
    }
    if (same) return;
    this.occupied.clear();
    for (const id of ids) this.occupied.add(id);
    for (const o of this.occluders) o.setIgnored(this.occupied);
    this.lastCover.valid = false;
  }

  setOccupiedAnchor(next: Anchor): void {
    const cur = this.selfAnchor;
    if (!next.active && !cur.active) return;
    if (next.active && cur.active) {
      const dx = next.x - cur.x;
      const dy = next.y - cur.y;
      const dz = next.z - cur.z;
      if (dx * dx + dy * dy + dz * dz < ANCHOR_MOVE_EPSILON * ANCHOR_MOVE_EPSILON) return;
    }
    cur.active = next.active;
    cur.x = next.x;
    cur.y = next.y;
    cur.z = next.z;
    for (const o of this.occluders) o.setAnchor(cur);
    this.lastCover.valid = false;
  }

  updateOccupantSilhouette(
    playerId: string,
    camera: THREE.Vector3,
    targets: readonly THREE.Vector3[],
    own: ReadonlySet<string>,
    ownAnchor: Anchor,
  ): void {
    const anchor = ownAnchor.active ? ownAnchor : this.selfAnchor;
    const ignore = this.probeIgnore;
    ignore.clear();
    for (const id of own) ignore.add(id);
    for (const id of this.occupied) ignore.add(id);
    let hidden = false;
    for (const o of this.occluders) {
      for (const t of targets) {
        if (o.blocksSegment(camera.x, camera.y, camera.z, t.x, t.y, t.z, ignore, anchor)) {
          hidden = true;
          break;
        }
      }
      if (hidden) break;
    }
    if (hidden) {
      this.suppressed.delete(playerId);
    } else {
      this.suppressed.add(playerId);
    }
  }

  clearOccupantSilhouette(playerId: string): void {
    this.suppressed.delete(playerId);
  }

  silhouetteSuppressed(playerId: string): boolean {
    return this.suppressed.has(playerId);
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
    this.selfAnchor.active = false;
    this.suppressed.clear();
    for (const o of this.occluders) o.restore();
  }
}
