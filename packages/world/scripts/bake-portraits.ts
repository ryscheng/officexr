#!/usr/bin/env tsx
/**
 * Renders a head-and-shoulders portrait of every built-in character with the runtime portrait
 * renderer and writes them to src/characters/portraits/<id>.webp, plus manifest.json with the
 * SHA-256 of each model so a test can tell when a model changed and the portraits are stale.
 *
 * Usage: pnpm --filter @officexr/world bake:portraits
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { CHARACTERS } from '../src/characters/registry.ts';

const worldDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = path.resolve(worldDir, '../studio/public/models/characters');
const outDir = path.join(worldDir, 'src/characters/portraits');

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const server = await createServer({
  root: worldDir,
  configFile: false,
  publicDir: path.resolve(worldDir, '../studio/public'),
  logLevel: 'warn',
  server: { host: '127.0.0.1', port: 0 },
  plugins: [
    {
      name: 'bake-portraits-page',
      configureServer: (s) => {
        s.middlewares.use((req, res, next) => {
          if (req.url !== '/') {
            return next();
          }
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><title>bake portraits</title>');
        });
      },
    },
  ],
});
await server.listen();
const origin = server.resolvedUrls?.local[0];
if (!origin) {
  throw new Error('the dev server has no local URL');
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  await page.goto(origin);
  fs.mkdirSync(outDir, { recursive: true });
  const manifest: Record<string, string> = {};
  for (const name of CHARACTERS) {
    const dataUrl = await page.evaluate(
      async ({ id, entry }) => {
        const { bakeCharacterPortrait } = (await import(entry)) as typeof import('../src/renderer/characterPortrait.ts');
        return bakeCharacterPortrait(`/models/characters/${id}.glb`, 'image/webp');
      },
      { id: name, entry: '/src/renderer/characterPortrait.ts' },
    );
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    fs.writeFileSync(path.join(outDir, `${name}.webp`), bytes);
    manifest[name] = sha256(path.join(modelsDir, `${name}.glb`));
    console.log(`${name}.webp ${bytes.length} bytes`);
  }
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
} finally {
  await browser.close();
  await server.close();
}
