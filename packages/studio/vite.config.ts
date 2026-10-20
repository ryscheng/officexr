import { access, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import studioStorage from '@officexr/world/vite-plugin-storage';
import bots from '@officexr/world/vite-plugin-bots';

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

const WORLD_DIR = fileURLToPath(new URL('../world', import.meta.url));
const DATA_DIR = process.env.OFFICEXR_STUDIO_DATA_DIR;

type StorageEntry = { kind: 'dir' | 'file'; name: string };
const STORAGE_ENTRIES = {
  rooms: { kind: 'dir', name: 'rooms' },
  maps: { kind: 'dir', name: 'maps' },
  layouts: { kind: 'dir', name: 'layouts' },
  bakedLayouts: { kind: 'dir', name: 'baked-layouts' },
  legacyScenes: { kind: 'dir', name: 'scenes' },
  catalog: { kind: 'file', name: 'world-object-kinds.json' },
} satisfies Record<string, StorageEntry>;

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

// ponytail: copy-if-missing only; updated defaults never merge into an existing data dir.
async function seedDataDir(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  for (const { kind, name } of Object.values(STORAGE_ENTRIES)) {
    const src = path.join(WORLD_DIR, name);
    const dst = path.join(dataDir, name);
    if (await exists(dst)) {
      continue;
    }
    if (await exists(src)) {
      await cp(src, dst, { recursive: true });
    } else if (kind === 'dir') {
      await mkdir(dst);
    }
  }
}

const storageOptions = (dataDir: string) =>
  Object.fromEntries(
    Object.entries(STORAGE_ENTRIES).map(([key, { kind, name }]) => [
      key,
      kind === 'dir'
        ? { dir: path.join(dataDir, name) }
        : { file: path.join(dataDir, name) },
    ]),
  );

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Mounts the studio's authoring REST surface (OFFICEXR_STUDIO_DATA_DIR moves
    // every path below under that dir):
    //   /api/rooms      → packages/world/rooms/      (FilesystemRoomStorage)
    //   /api/maps       → packages/world/maps/       (FilesystemMapStorage)
    //   /api/world-object-kinds → packages/world/world-object-kinds.json (Object editor catalog; Task 3)
    //   /api/scenes     → packages/world/scenes/     (legacy back-compat for the
    //                                                 existing Scenes editor until Task 5)
    studioStorage(DATA_DIR ? storageOptions(DATA_DIR) : {}),
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
    bots({ env: { OFFICE_ID: 'studio-office' } }),
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
