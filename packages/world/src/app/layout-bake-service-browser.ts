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
 * - `publish` via a `fetch` PUT to `/api/baked-layouts/:name` (or `basePath`).
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
import { FilesystemBakedLayoutStorage } from '../scenes/filesystem-baked-layout-storage.ts';
import { globalFetch } from '../scenes/storage.ts';

export interface BrowserBakeOptions {
  /** Baked-layout endpoint the result is PUT to; defaults to the storage's own. */
  basePath?: string;
  /** Prefixed to each kind's `gltfPath`; must serve the uncompressed source models. */
  modelBaseUrl?: string;
  /** Used for every model load and the PUT. */
  fetch?: typeof fetch;
}

/** WebIO whose reads (the model and its `.bin` / texture resources) go through an injected fetch. */
class FetchWebIO extends WebIO {
  constructor(private readonly fetchFn: typeof fetch) {
    super();
  }

  protected override readURI(uri: string, type: 'view'): Promise<Uint8Array<ArrayBuffer>>;
  protected override readURI(uri: string, type: 'text'): Promise<string>;
  protected override async readURI(uri: string, type: 'view' | 'text'): Promise<Uint8Array<ArrayBuffer> | string> {
    const response = await this.fetchFn(uri);
    return type === 'text' ? response.text() : new Uint8Array(await response.arrayBuffer());
  }
}

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
  { basePath, modelBaseUrl = '', fetch = globalFetch }: BrowserBakeOptions = {},
): BakeDeps {
  const kindLookup: BakeDeps['kindLookup'] = (kindId) =>
    catalog.getKind(kindId) ?? undefined;

  // Single WebIO reused across loads so the source-doc parse path
  // benefits from drei-style URI resolution caching. WebIO.read()
  // auto-detects JSON .gltf vs binary .glb and fetches external
  // resources (.bin, textures) relative to the URL.
  const webio = new FetchWebIO(fetch);

  const gltfLoader: BakeDeps['gltfLoader'] = async (url, kind) => {
    if (kind.sourceObject) {
      throw new Error(
        `createBrowserBakeDeps gltfLoader: kind "${kind.id}" has a private model source, which can't be baked in the browser`,
      );
    }
    let doc;
    try {
      doc = await webio.read(`${modelBaseUrl}${url}`);
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

  const baked = new FilesystemBakedLayoutStorage({ basePath, fetch });
  const publish: BakeDeps['publish'] = (layoutName, glb) => baked.save(layoutName, glb);

  return { kindLookup, gltfLoader, publish, geometry };
}
