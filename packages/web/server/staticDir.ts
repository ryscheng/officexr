import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import type { Connect } from 'vite';

const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function decodePath(urlPath: string): string | null {
  try {
    return decodeURIComponent(urlPath);
  } catch {
    return null;
  }
}

async function serveFile(root: string, prefix: string, req: Connect.IncomingMessage, res: ServerResponse): Promise<boolean> {
  const decoded = decodePath(req.url!.split('?')[0].slice(prefix.length));
  if (decoded === null) {
    res.statusCode = 400;
    res.end();
    return true;
  }
  const file = path.join(root, decoded);
  if (!file.startsWith(root + path.sep)) {
    return false;
  }
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    return false;
  }
  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Content-Length', info.size);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  await new Promise<void>((resolve, reject) => {
    createReadStream(file).on('error', reject).on('end', resolve).pipe(res);
  });
  return true;
}

/** Serves the files under `dir` at `prefix`, read at request time so assets installed after the build are found. */
export function staticDirMiddleware(prefix: string, dir: string): Connect.NextHandleFunction {
  const root = path.resolve(dir);
  return (req, res, next) => {
    const urlPath = req.url?.split('?')[0] ?? '';
    if (!urlPath.startsWith(`${prefix}/`) || (req.method !== 'GET' && req.method !== 'HEAD')) {
      return next();
    }
    serveFile(root, prefix, req, res).then((served) => !served && next(), next);
  };
}
