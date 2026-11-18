#!/usr/bin/env tsx
/**
 * Bakes the 2D view's sprites from the same KayKit models the 3D view renders, so both views
 * show one office. Furniture is rendered at four yaws through the 2D view's oblique projection
 * (`ELEVATION`), so each sprite's footprint lands exactly on its object's footprint; characters
 * get a sheet of four facings × idle, walk cycle and seated.
 *
 * Prerequisites: `pnpm asset-packs:install` (the furniture and restaurant packs).
 * Usage:        pnpm --filter @officexr/world bake:sprites
 * Options:      --models <dir>  the folder holding `models/` (default packages/studio/public)
 *               --three <dir>   a three.js checkout or package (default the installed `three`)
 *               --only <id,...> bake just these kinds (characters are skipped)
 *
 * Output: packages/world/sprites/{kinds,characters}/*.webp and src/top-down/spriteManifest.ts.
 * Kinds outside the furniture and restaurant packs (prototype blocks, the bundled blocks, uploads)
 * have no sprite and keep their procedural painter.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ELEVATION } from '../src/top-down/topDownPainters.ts';
import { SIT_POSE_DEGREES } from '../src/renderer/sitPoseClip.ts';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright') as typeof import('playwright');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORLD = path.resolve(ROOT, '..');
const OUT = path.join(WORLD, 'sprites');
const MANIFEST = path.join(WORLD, 'src/top-down/spriteManifest.ts');
const CATALOG = path.join(WORLD, 'world-object-kinds.json');

/** Furniture pixels per metre: sharp at the 2D view's usual zoom on a 2× screen. */
const KIND_PPM = 96;
/** Characters are drawn larger than life (see `CHARACTER_SCALE`), so they get more pixels. */
const CHARACTER_PPM = 128;
/**
 * Characters get a true orthographic camera pitched this far below horizontal, not the
 * furniture's oblique projection: that one looks almost straight down on a standing figure, so
 * you see a hat and no face. Gather's characters face the viewer the same way.
 */
const CHARACTER_PITCH_DEG = 35;
/** Screen metres per metre of a character's height at that pitch. */
const CHARACTER_ELEVATION = Math.cos((CHARACTER_PITCH_DEG * Math.PI) / 180);
const WALK_FRAMES = 8;
const OUTLINE = { colour: 'rgba(38, 30, 28, 0.55)', width: 1.25 };
const SPRITE_CATEGORIES = new Set(['furniture', 'restaurant']);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const modelsRoot = path.resolve(arg('models') ?? path.join(WORLD, '../studio/public'));
const threeRoot = path.resolve(arg('three') ?? path.dirname(require.resolve('three/package.json', { paths: [WORLD] })));
const only = arg('only')?.split(',');

interface CatalogKind {
  id: string;
  gltfPath: string;
  scale: number;
  category: string;
}

const TYPES: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg' };

/** Serves the bake page, three.js and the models from one origin, so the page needs no bundler. */
function serve(): Promise<http.Server> {
  const mounts: [string, string][] = [['/three/', threeRoot], ['/models/', path.join(modelsRoot, 'models')], ['/bake/', path.join(ROOT, 'sprite-bake')]];
  const page = `<!doctype html><meta charset="utf-8"><script type="importmap">${JSON.stringify({
    imports: { three: '/three/build/three.module.js', 'three/examples/jsm/': '/three/examples/jsm/' },
  })}</script><script type="module" src="/bake/bake-page.js"></script>`;
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(page);
      return;
    }
    const mount = mounts.find(([prefix]) => url.startsWith(prefix));
    const file = mount && path.join(mount[1], url.slice(mount[0].length));
    if (!file || !file.startsWith(mount[1]) || !fs.existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const writeImage = (file: string, dataUrl: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
};

/** Keeps a TS manifest entry readable in review. */
const entry = (value: unknown) => JSON.stringify(value);

async function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8')) as { kinds: CatalogKind[] };
  const kinds = catalog.kinds.filter(
    (k) =>
      SPRITE_CATEGORIES.has(k.category) &&
      (!only || only.includes(k.id)) &&
      fs.existsSync(path.join(modelsRoot, k.gltfPath)),
  );
  const missing = catalog.kinds.filter((k) => SPRITE_CATEGORIES.has(k.category) && !fs.existsSync(path.join(modelsRoot, k.gltfPath)));
  if (missing.length > 0) {
    console.warn(`[bake-sprites] ${missing.length} kinds have no model under ${modelsRoot}; run pnpm asset-packs:install.`);
  }
  const characterDir = path.join(modelsRoot, 'models/characters');
  const characters = only ? [] : fs.readdirSync(characterDir).filter((f) => f.endsWith('.glb')).map((f) => f.slice(0, -4));

  const server = await serve();
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('[bake-sprites] page error:', err.message));
  await page.goto(origin);
  await page.waitForFunction(() => (window as unknown as { bakeReady?: boolean }).bakeReady === true);

  const kindEntries: string[] = [];
  for (const kind of kinds) {
    try {
      const baked = await page.evaluate(
        (o) => (window as unknown as { bakeKind: (o: unknown) => Promise<{ image: string; frames: unknown[] }> }).bakeKind(o),
        { url: kind.gltfPath, scale: kind.scale, ppm: KIND_PPM, elevation: ELEVATION, outline: OUTLINE },
      );
      writeImage(path.join(OUT, 'kinds', `${kind.id}.webp`), baked.image);
      kindEntries.push(`    ${entry(kind.id)}: { url: new URL('../../sprites/kinds/${kind.id}.webp', import.meta.url).href, frames: ${entry(baked.frames)} },`);
      console.log(`[bake-sprites] ${kind.id}`);
    } catch (err) {
      console.warn(`[bake-sprites] skipped ${kind.id}: ${(err as Error).message}`);
    }
  }

  const characterEntries: string[] = [];
  for (const name of characters) {
    const baked = await page.evaluate(
      (o) => (window as unknown as { bakeCharacter: (o: unknown) => Promise<Record<string, unknown> & { image: string }> }).bakeCharacter(o),
      {
        url: `/models/characters/${name}.glb`,
        walk: { url: '/models/animations/Rig_Medium_MovementBasic.glb', name: 'Walking_A' },
        idle: { url: '/models/animations/Rig_Medium_General.glb', name: 'Idle_A' },
        sitPose: SIT_POSE_DEGREES,
        walkFrames: WALK_FRAMES,
        ppm: CHARACTER_PPM,
        pitchDeg: CHARACTER_PITCH_DEG,
        outline: OUTLINE,
      },
    );
    const { image, ...sheet } = baked;
    writeImage(path.join(OUT, 'characters', `${name}.webp`), image);
    characterEntries.push(`    ${entry(name)}: { url: new URL('../../sprites/characters/${name}.webp', import.meta.url).href, ...${entry(sheet)} },`);
    console.log(`[bake-sprites] character ${name}`);
  }
  await browser.close();
  server.close();

  if (only) {
    console.log('[bake-sprites] --only given: sprites written, manifest left as is.');
    return;
  }
  fs.writeFileSync(
    MANIFEST,
    `// Auto-generated by \`pnpm --filter @officexr/world bake:sprites\` — do not edit by hand.
import type { SpriteManifest } from './sprites.ts';

export const SPRITE_MANIFEST: SpriteManifest = {
  kindPpm: ${KIND_PPM},
  characterPpm: ${CHARACTER_PPM},
  elevation: ${ELEVATION},
  characterElevation: ${CHARACTER_ELEVATION.toFixed(4)},
  kinds: {
${kindEntries.join('\n')}
  },
  characters: {
${characterEntries.join('\n')}
  },
};
`,
  );
  console.log(`[bake-sprites] ${kindEntries.length} kinds, ${characterEntries.length} characters → ${MANIFEST}`);
}

await main();
