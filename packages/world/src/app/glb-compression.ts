/**
 * Meshopt + mesh-quantization compression for glTF documents. Headless and
 * environment-agnostic: works with `NodeIO` and `WebIO`.
 */

import type { Transform, PlatformIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** Quantizes and meshopt-compresses every mesh (the transform also reorders). */
export const compressDocument: Transform = meshopt({ encoder: MeshoptEncoder });

/**
 * Registers the extensions plus meshopt encoder and decoder on `io`, so it can
 * write documents after `compressDocument` and read compressed files back.
 */
export async function registerCompressionCodecs<T extends PlatformIO>(
  io: T,
): Promise<T> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  io.registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });
  return io;
}
