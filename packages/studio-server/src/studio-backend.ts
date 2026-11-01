import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_ENTRIES, type StudioStoragePluginOptions } from '@officexr/world/vite-plugin-storage';
import { pushWorldConstants } from './push-world-constants.ts';
import { createR2Publisher, r2ConfigFromEnv, type R2Publisher } from './r2-publisher.ts';

const WORLD_DIR = fileURLToPath(new URL('../../world', import.meta.url));
export const STUDIO_MODELS_DIR = fileURLToPath(new URL('../../studio/public/models', import.meta.url));

/** The studio's storage hooks and R2 sync, shared by the Vite studio and the standalone server. */
export function studioBackend(env: NodeJS.ProcessEnv) {
  const dataDir = env.OFFICEXR_STUDIO_DATA_DIR;
  // A bot server run outside the studio is pushed to only when listed here,
  // and must share OFFICEXR_REALTIME_ADMIN_TOKEN.
  const pushTargets = new Set(
    (env.OFFICEXR_WORLD_CONSTANTS_PUSH_TARGETS ?? '')
      .split(',')
      .map((t) => t.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );
  const adminToken = env.OFFICEXR_REALTIME_ADMIN_TOKEN ?? randomUUID();

  // Created on first server start or layout hook, so `vite build` never builds one.
  let publisher: R2Publisher | null | undefined;
  const r2Publisher = (): R2Publisher | null => {
    if (publisher === undefined) {
      const config = r2ConfigFromEnv(env);
      publisher = config ? createR2Publisher(config) : null;
    }
    return publisher;
  };

  const storageOptions: StudioStoragePluginOptions = {
    dataDir,
    worldSettings: {
      onSaved: (doc) => pushWorldConstants({ targets: [...pushTargets], token: adminToken, doc }),
    },
    bakedLayouts: {
      onSaved: async (name, bytes) => r2Publisher()?.bakedLayoutHooks.onSaved(name, bytes),
      onDeleted: async (name) => r2Publisher()?.bakedLayoutHooks.onDeleted(name),
    },
  };

  const startR2Sync = (): void => {
    const bucket = r2ConfigFromEnv(env)?.bucket;
    console.log(
      bucket
        ? `[r2-publisher] publishing assets to bucket ${bucket}`
        : '[r2-publisher] off: OFFICEXR_R2_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY not all set',
    );
    void r2Publisher()?.sync({
      modelsDir: STUDIO_MODELS_DIR,
      bakedLayoutsDir: path.join(dataDir ?? WORLD_DIR, STORAGE_ENTRIES.bakedLayouts.name),
    });
  };

  return { dataDir, pushTargets, adminToken, storageOptions, startR2Sync };
}
