import type { RoomDocument } from '@officexr/world/scenes';

/**
 * Future hook for exporting a compiled Room as a single optimized
 * `.glb` (one mesh per kind, baked materials, no editor metadata).
 * The Map editor will use this to compile a Room into a single GLB
 * for fast runtime loading at scale — composing maps from 50+ rooms
 * with no per-cube draw calls.
 *
 * Implementation is stubbed in Task 15 — we intentionally ship the
 * interface + a `StubRoomExporter` so:
 *   - The Room editor's toolbar can render a (disabled) "Export GLB"
 *     button without `// TODO` noise.
 *   - Downstream code that wants to call `exportGLB` can compile
 *     against the stable shape today.
 *
 * A future implementation will likely use three's `GLTFExporter`:
 *   1. Build an in-memory THREE.Scene with the compiled
 *      ObjectInstance positions baked into per-kind InstancedMesh
 *      matrices.
 *   2. Hand the scene to `new GLTFExporter().parseAsync(scene, {
 *      binary: true })`.
 *   3. Return the `ArrayBuffer`.
 */
export interface RoomExporter {
  /** Export a compiled Room to a binary `.glb`. */
  exportGLB(room: RoomDocument): Promise<ArrayBuffer>;
}

export class StubRoomExporter implements RoomExporter {
  async exportGLB(_room: RoomDocument): Promise<ArrayBuffer> {
    throw new Error(
      'RoomExporter.exportGLB is not implemented yet (Task 15 stub).',
    );
  }
}
