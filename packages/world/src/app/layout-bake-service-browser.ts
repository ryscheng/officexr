/**
 * Browser-side `BakeDeps` factory for `bakeLayout` / `BakeRegistry`.
 *
 * Wires up:
 * - `kindLookup` from an in-memory `CatalogService`.
 * - `gltfLoader` via `fetch` (standard browser API; works in any modern browser
 *   or Service Worker).
 * - `publish` via a `fetch` PUT to `/api/baked-layouts/:name`.
 *
 * CONTRACT
 * --------
 * - Zero imports from `three`, `react`, or any DOM API beyond `fetch`.
 * - `fetch` is the only browser global used; it is available in all modern
 *   browsers and Node 18+.
 */

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

  const gltfLoader: BakeDeps['gltfLoader'] = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `createBrowserBakeDeps gltfLoader: GET ${url} → ${res.status} ${res.statusText}`,
      );
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
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
