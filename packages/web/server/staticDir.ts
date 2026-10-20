import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { Connect } from 'vite';

const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

/** Serves the files under `dir` at `prefix`, read at request time so assets installed after the build are found. */
export function staticDirMiddleware(prefix: string, dir: string): Connect.NextHandleFunction {
  const root = path.resolve(dir);
  return async (req, res, next) => {
    const urlPath = req.url?.split('?')[0] ?? '';
    if (!urlPath.startsWith(`${prefix}/`) || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return next();
    }
    const file = path.join(root, decodeURIComponent(urlPath.slice(prefix.length)));
    if (!file.startsWith(root + path.sep)) {
      return next();
    }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      return next();
    }
    res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).on('error', next).pipe(res);
  };
}
