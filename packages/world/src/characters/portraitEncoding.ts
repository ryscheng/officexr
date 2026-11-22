export const PORTRAIT_MIME = 'image/webp';
export const PORTRAIT_FALLBACK_MIME = 'image/png';
export const PORTRAIT_QUALITY = 0.85;

interface Encodable {
  toDataURL(type?: string, quality?: number): string;
}

/** WebP at `PORTRAIT_QUALITY`, or PNG when the browser cannot encode WebP (it then silently returns PNG for any unknown type). */
export function encodePortrait(canvas: Encodable): string {
  const webp = canvas.toDataURL(PORTRAIT_MIME, PORTRAIT_QUALITY);
  return webp.startsWith(`data:${PORTRAIT_MIME}`) ? webp : canvas.toDataURL(PORTRAIT_FALLBACK_MIME);
}
