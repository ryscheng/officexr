const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
};

/** `Content-Type` for a model asset path or key, by extension; `application/octet-stream` when unknown. */
export function assetContentType(file: string): string {
  const ext = /\.[^./]+$/.exec(file)?.[0].toLowerCase();
  return (ext && CONTENT_TYPES[ext]) || 'application/octet-stream';
}
