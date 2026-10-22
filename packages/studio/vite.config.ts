import { randomUUID } from 'node:crypto';
import { access, cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import studioStorage, { STORAGE_ENTRIES } from '@officexr/world/vite-plugin-storage';
import bots from '@officexr/world/vite-plugin-bots';
import { parsePushTargets, pushWorldConstants } from './server/push-world-constants.ts';

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

// Realtime servers the studio pushes saved world settings to. The bot server
// the dev server spawns itself joins this list (see `bots` below) and gets a
// per-start admin token; an externally run one is only pushed to when listed.
const pushTargets = parsePushTargets(process.env.OFFICEXR_WORLD_CONSTANTS_PUSH_TARGETS);
const adminToken = process.env.OFFICEXR_REALTIME_ADMIN_TOKEN ?? randomUUID();

const WORLD_DIR = fileURLToPath(new URL('../world', import.meta.url));
const DATA_DIR = process.env.OFFICEXR_STUDIO_DATA_DIR;

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
  for (const [key, { kind, name }] of Object.entries(STORAGE_ENTRIES)) {
    // No default document: absence means the sdk defaults.
    if (key === 'worldSettings') {
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
        onSaved: (doc) => pushWorldConstants({ targets: pushTargets, token: adminToken, doc }),
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
      onSpawn: () => pushTargets.push(REALTIME_TARGET),
    }),
  ],
  // proxy and host are inherited from `server`.
  preview: {
    port: 5174,
    allowedHosts: true, // only reachable via the Tailscale ingress
  },
  server: {
    port: 5174,
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
