/**
 * Meshopt + mesh-quantization compression for glTF documents. Headless and
 * environment-agnostic: works with `NodeIO` and `WebIO`.
 */

import type { Transform, PlatformIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

/** Quantizes and meshopt-compresses every mesh (the transform also reorders). */
export const compressDocument: Transform = meshopt({ encoder: MeshoptEncoder });

/**
 * Registers the extensions and encoder that `compressDocument` needs on `io`
 * so the document can be written (and compressed files read back).
 */
export async function registerCompressionCodecs<T extends PlatformIO>(
  io: T,
): Promise<T> {
  await MeshoptEncoder.ready;
  io.registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
  });
  return io;
}
