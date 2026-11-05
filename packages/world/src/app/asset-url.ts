import { z } from 'zod';
import { bakedLayoutUrl } from './baked-layout-url.ts';

const MODELS_PREFIX = '/models/';

let assetBase: string | null = null;

/** Base URL (e.g. a CDN) serving `/models/...` and baked layouts. A trailing slash is stripped; `null` or `''` means unset. */
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

/** URL of a sound's MP3: the asset base when set, else the studio's `/api/sounds`. */
export function soundAssetUrl(name: string): string {
  return `${assetBase ? `${assetBase}/sounds` : '/api/sounds'}/${encodeURIComponent(name)}.mp3`;
}

/** URL of the sound catalog: the CDN manifest when the asset base is set, else the studio listing. */
export function soundCatalogUrl(): string {
  return assetBase ? `${assetBase}/sounds/index.json` : '/api/sounds/';
}

const soundCatalogSchema = z.object({
  sounds: z.array(z.object({ name: z.string(), size: z.number(), updatedAt: z.number() })),
});

export type SoundCatalog = z.infer<typeof soundCatalogSchema>;

/** Fetches and validates the catalog; an empty catalog on any network or validation failure. */
export async function fetchSoundCatalog(url: string, fetchFn: typeof fetch = fetch): Promise<SoundCatalog> {
  try {
    const res = await fetchFn(url);
    const parsed = soundCatalogSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : { sounds: [] };
  } catch {
    return { sounds: [] };
  }
}
