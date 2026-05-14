/**
 * HDRI preset URLs the Environment panel exposes. The values are
 * drei's `<Environment preset=...>` built-in identifiers — drei
 * fetches the HDR from its CDN, no extra asset shipping needed.
 *
 * `none` is the explicit "no HDRI" choice; the Environment panel
 * sets `environment.hdri = null` when this is picked.
 *
 * Forward-compatibility: when we want to support user-uploaded
 * `.hdr` files, the schema's `hdri.url` becomes a real URL and we
 * pass it to `<Environment files={url}>` instead of `preset={...}`.
 * For v1 we stash the preset name in `url` so the doc shape doesn't
 * need a new discriminator.
 */
export const HDRI_PRESETS = [
  'none',
  'apartment',
  'city',
  'dawn',
  'forest',
  'lobby',
  'night',
  'park',
  'studio',
  'sunset',
  'warehouse',
] as const;

export type HdriPresetName = (typeof HDRI_PRESETS)[number];
