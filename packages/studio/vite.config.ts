import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import studioStorage, { STORAGE_ENTRIES, type StorageEntry } from '@officexr/world/vite-plugin-storage';
import bots from '@officexr/world/vite-plugin-bots';
import { pushWorldConstants } from './server/push-world-constants.ts';
import { createR2Publisher, r2ConfigFromEnv, type R2Publisher } from './server/r2-publisher.ts';

/**
 * The custom realtime server (`@officexr/realtime-server`, started by
 * `pnpm bots:start`) listens on 127.0.0.1:8787 of the *Vite host*.
 * When you're developing remotely (browser on your laptop, Vite + the
 * realtime server on a remote box) the browser can't reach 127.0.0.1
 * itself, so we proxy `/ws` and `/health` through the Vite dev server.
 *
 * The browser's WsChannel uses `${window.location.origin}/ws` as its
 * WebSocket URL by default, so all traffic rides the same connection
 * the page was served over.
 */
const REALTIME_TARGET =
  process.env.REALTIME_SERVER_TARGET ?? 'http://127.0.0.1:8787';

// A bot server run outside the dev server is pushed to only when listed here,
// and must share OFFICEXR_REALTIME_ADMIN_TOKEN.
const pushTargets = new Set(
  (process.env.OFFICEXR_WORLD_CONSTANTS_PUSH_TARGETS ?? '')
    .split(',')
    .map((t) => t.trim().replace(/\/$/, ''))
    .filter(Boolean),
);
const adminToken = process.env.OFFICEXR_REALTIME_ADMIN_TOKEN ?? randomUUID();

const WORLD_DIR = fileURLToPath(new URL('../world', import.meta.url));
const DATA_DIR = process.env.OFFICEXR_STUDIO_DATA_DIR;

// Created on first server start or layout hook, so `vite build` never builds one.
let publisher: R2Publisher | null | undefined;
function r2Publisher(): R2Publisher | null {
  if (publisher === undefined) {
    const config = r2ConfigFromEnv(process.env);
    publisher = config ? createR2Publisher(config) : null;
  }
  return publisher;
}

function startR2Sync(): void {
  const bucket = r2ConfigFromEnv(process.env)?.bucket;
  console.log(
    bucket
      ? `[r2-publisher] publishing assets to bucket ${bucket}`
      : '[r2-publisher] off: OFFICEXR_R2_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY not all set',
  );
  void r2Publisher()?.sync({
    modelsDir: fileURLToPath(new URL('./public/models', import.meta.url)),
    bakedLayoutsDir: path.join(DATA_DIR ?? WORLD_DIR, STORAGE_ENTRIES.bakedLayouts.name),
  });
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

// Written once the whole seed has copied, so a seed interrupted mid-copy
// (e.g. the container is killed) resumes on the next start, while files the
// user deletes after a completed seed are never re-seeded.
const SEED_MARKER = '.seeded';

// ponytail: copy-if-missing only; updated defaults never merge into an existing data dir.
async function seedDataDir(dataDir: string): Promise<void> {
  const marker = path.join(dataDir, SEED_MARKER);
  if (await exists(marker)) {
    return;
  }
  await mkdir(dataDir, { recursive: true });
  for (const { kind, name, seed } of Object.values<StorageEntry>(STORAGE_ENTRIES)) {
    if (seed === false) {
      continue;
    }
    const src = path.join(WORLD_DIR, name);
    const dst = path.join(dataDir, name);
    if (await exists(src)) {
      await cp(src, dst, { recursive: true, force: false, errorOnExist: false });
    } else if (kind === 'dir') {
      await mkdir(dst, { recursive: true });
    }
  }
  await writeFile(marker, '');
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Mounts the studio's authoring REST surface (OFFICEXR_STUDIO_DATA_DIR moves
    // every path below under that dir):
    //   /api/rooms      → packages/world/rooms/      (FilesystemRoomStorage)
    //   /api/maps       → packages/world/maps/       (FilesystemMapStorage)
    //   /api/world-object-kinds → packages/world/world-object-kinds.json (Object editor catalog; Task 3)
    //   /api/world-settings → packages/world/world-settings.json (saved world constants; pushed to realtime servers)
    //   /api/scenes     → packages/world/scenes/     (legacy back-compat for the
    //                                                 existing Scenes editor until Task 5)
    studioStorage({
      dataDir: DATA_DIR,
      worldSettings: {
        onSaved: (doc) => pushWorldConstants({ targets: [...pushTargets], token: adminToken, doc }),
      },
      bakedLayouts: {
        onSaved: async (name, bytes) => r2Publisher()?.bakedLayoutHooks.onSaved(name, bytes),
        onDeleted: async (name) => r2Publisher()?.bakedLayoutHooks.onDeleted(name),
      },
    }),
    {
      name: 'officexr:seed-data-dir',
      async configureServer() {
        if (DATA_DIR) {
          await seedDataDir(DATA_DIR);
        }
      },
      async configurePreviewServer() {
        if (DATA_DIR) {
          await seedDataDir(DATA_DIR);
        }
      },
    },
    // After the seed, so the sync sees seeded layouts.
    {
      name: 'officexr:r2-publish',
      configureServer: startR2Sync,
      configurePreviewServer: startR2Sync,
    },
    // Spawns the Node bot CLI as a child process for the lifetime of
    // the dev server, so `pnpm dev:studio` is one-command. If you'd
    // rather run `pnpm bots:start` yourself in a second terminal, the
    // plugin probes the health endpoint first and skips spawning when
    // it sees an existing instance.
    //
    // OFFICE_ID must match `StudioPage.tsx`'s `OFFICE_ID` constant so
    // the spawned bots and the browser join the same WS office.
    bots({
      env: (server) => ({
        OFFICE_ID: 'studio-office',
        OFFICEXR_WORLD_CONSTANTS_URL: `http://127.0.0.1:${server.config.server.port}/api/world-settings`,
        OFFICEXR_REALTIME_ADMIN_TOKEN: adminToken,
      }),
      onSpawn: (baseUrl) => pushTargets.add(baseUrl),
    }),
  ],
  // proxy and host are inherited from `server`.
  preview: {
    port: 5174,
    allowedHosts: true, // only reachable via the Tailscale ingress
  },
  server: {
    port: 5174,
    // The spawned bot server reads this server's settings by port, so it must not move.
    strictPort: true,
    host: true, // listen on 0.0.0.0 so remote browsers can reach the dev server
    proxy: {
      '/ws': {
        target: REALTIME_TARGET,
        changeOrigin: true,
        ws: true,
        secure: false,
      },
      '/health': {
        target: REALTIME_TARGET,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
