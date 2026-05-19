/**
 * Browser-side `BakeDeps` factory for `bakeLayout` / `BakeRegistry`.
 *
 * Wires up:
 * - `kindLookup` from an in-memory `CatalogService`.
 * - `gltfLoader` that uses `WebIO.read()` so both JSON `.gltf` (with
 *   external `.bin` and image references) and binary `.glb` sources
 *   work — the source bytes are re-emitted as GLB before they reach
 *   `bakeLayout`, which calls `io.readBinary()` and would otherwise
 *   throw "Invalid glTF 2.0 binary" on JSON inputs. Mirrors the
 *   pattern used by the Node CLI's `bake:layout` script.
 * - `publish` via a `fetch` PUT to `/api/baked-layouts/:name`.
 *
 * CONTRACT
 * --------
 * - Zero imports from `three` or `react`.
 * - Uses `WebIO` from `@gltf-transform/core`; available in any modern
 *   browser and Node 18+.
 */

import { WebIO } from '@gltf-transform/core';
import type { CatalogService, InstanceGeometryService } from './types.ts';
import type { BakeDeps } from './bake-registry.ts';

/**
 * Build a `BakeDeps` object suitable for use in the browser.
 *
 * @param catalog   A live `CatalogService` instance (from the studio context).
 * @param geometry  The canonical `InstanceGeometryService` (also from the
 *                  studio context). Passed through so the bake uses the
 *                  same voxel→world math as the runtime renderer.
 */
export function createBrowserBakeDeps(
  catalog: CatalogService,
  geometry: InstanceGeometryService,
): BakeDeps {
  const kindLookup: BakeDeps['kindLookup'] = (kindId) =>
    catalog.getKind(kindId) ?? undefined;

  // Single WebIO reused across loads so the source-doc parse path
  // benefits from drei-style URI resolution caching. WebIO.read()
  // auto-detects JSON .gltf vs binary .glb and fetches external
  // resources (.bin, textures) relative to the URL.
  const webio = new WebIO();

  const gltfLoader: BakeDeps['gltfLoader'] = async (url: string) => {
    let doc;
    try {
      doc = await webio.read(url);
    } catch (err) {
      throw new Error(
        `createBrowserBakeDeps gltfLoader: read("${url}") failed: ${
          (err as Error).message
        }`,
      );
    }
    // Re-emit as binary GLB. bakeLayout calls `io.readBinary()` on
    // every source it loads, so the loader must produce GLB bytes
    // regardless of whether the on-disk asset was JSON or binary.
    return await webio.writeBinary(doc);
  };

  const publish: BakeDeps['publish'] = async (
    layoutName: string,
    glb: Uint8Array,
  ) => {
    const url = `/api/baked-layouts/${encodeURIComponent(layoutName)}`;
    // Send a copy of the underlying buffer; fetch() accepts ArrayBuffer as body.
    const body: BodyInit = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'model/gltf-binary' },
      body,
    });
    if (!res.ok) {
      throw new Error(
        `createBrowserBakeDeps publish: PUT ${url} → ${res.status} ${res.statusText}`,
      );
    }
  };

  return { kindLookup, gltfLoader, publish, geometry };
}
