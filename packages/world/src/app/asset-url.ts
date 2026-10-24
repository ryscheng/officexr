import { bakedLayoutUrl } from './baked-layout-url.ts';

const MODELS_PREFIX = '/models/';

let assetBase: string | null = null;

/** Origin (e.g. a CDN) serving `/models/...` and baked layouts; `null` keeps same-origin paths. */
export function setAssetBaseUrl(base: string | null): void {
  assetBase = base ? base.replace(/\/$/, '') : null;
}

/** Maps a root-relative `/models/...` path onto the asset base; anything else is returned unchanged. */
export function modelUrl(path: string): string {
  return assetBase && path.startsWith(MODELS_PREFIX) ? `${assetBase}${path}` : path;
}

/** Read-only URL of a layout's baked GLB: the asset base when set, else the pod's `bakedLayoutUrl`. */
export function bakedLayoutAssetUrl(layoutName: string): string {
  return assetBase ? `${assetBase}/baked-layouts/${encodeURIComponent(layoutName)}.glb` : bakedLayoutUrl(layoutName);
}
