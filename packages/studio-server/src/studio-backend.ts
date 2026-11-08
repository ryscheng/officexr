import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODELS_DIR, staticDirMiddleware } from '@officexr/server/static';
import { STORAGE_ENTRIES, type StudioStoragePluginOptions } from '@officexr/world/vite-plugin-storage';
import { pushWorldConstants } from './push-world-constants.ts';
import { createR2Publisher, r2ConfigFromEnv, type R2Publisher } from './r2-publisher.ts';

const WORLD_DIR = fileURLToPath(new URL('../../world', import.meta.url));

/** Where server-generated models persist: `$OFFICEXR_STUDIO_DATA_DIR/models`, else the gitignored `packages/world/uploaded-models`. */
export const uploadedModelsDirFor = (env: NodeJS.ProcessEnv) =>
  env.OFFICEXR_STUDIO_DATA_DIR ? path.join(env.OFFICEXR_STUDIO_DATA_DIR, 'models') : path.join(WORLD_DIR, 'uploaded-models');

/** Packs are the top-level directories of `dir` (the bundled models by default); an uploaded pack must not reuse one. */
export async function bundledModelPacks(dir: string = DEFAULT_MODELS_DIR): Promise<Set<string>> {
  const entries = await readdir(dir, { withFileTypes: true });
  return new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
}

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
  const uploadedDir = uploadedModelsDirFor(env);
  const soundsDir = path.join(dataDir ?? WORLD_DIR, STORAGE_ENTRIES.sounds.name);

  // Created on first server start or layout/sound hook, so `vite build` never builds one.
  let publisher: R2Publisher | null | undefined;
  const r2Publisher = (): R2Publisher | null => {
    if (publisher === undefined) {
      const config = r2ConfigFromEnv(env);
      publisher = config ? createR2Publisher(config) : null;
    }
    return publisher;
  };

  let soundHooks: ReturnType<R2Publisher['soundHooks']> | undefined;
  const sounds = () => (soundHooks ??= r2Publisher()?.soundHooks(soundsDir));

  const storageOptions: StudioStoragePluginOptions = {
    dataDir,
    worldSettings: {
      onSaved: (doc) => pushWorldConstants({ targets: [...pushTargets], token: adminToken, doc }),
    },
    bakedLayouts: {
      onSaved: async (name, bytes) => r2Publisher()?.bakedLayoutHooks.onSaved(name, bytes),
      onDeleted: async (name) => r2Publisher()?.bakedLayoutHooks.onDeleted(name),
    },
    sounds: {
      dir: soundsDir,
      onSaved: async (name, bytes) => sounds()?.onSaved(name, bytes),
      onDeleted: async (name) => sounds()?.onDeleted(name),
    },
  };

  /** No-op when R2 isn't configured. `rel` is relative to the uploaded-models dir. */
  const publishModel = async (rel: string): Promise<void> => r2Publisher()?.publishModel(uploadedDir, rel);

  const startR2Sync = (): void => {
    const bucket = r2ConfigFromEnv(env)?.bucket;
    console.log(
      bucket
        ? `[r2-publisher] publishing assets to bucket ${bucket}`
        : '[r2-publisher] off: OFFICEXR_R2_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY not all set',
    );
    void r2Publisher()?.sync({
      modelsDirs: [DEFAULT_MODELS_DIR, uploadedDir],
      bakedLayoutsDir: path.join(dataDir ?? WORLD_DIR, STORAGE_ENTRIES.bakedLayouts.name),
      soundsDir,
    });
  };

  /** Must resolve before `startR2Sync`, whose model listing fails on a missing dir. */
  const ensureUploadedModelsDir = async (): Promise<void> => {
    await mkdir(uploadedDir, { recursive: true });
  };

  return {
    dataDir,
    uploadedModelsDir: uploadedDir,
    uploadedModelsMiddleware: staticDirMiddleware('/models', uploadedDir),
    pushTargets,
    adminToken,
    storageOptions,
    startR2Sync,
    ensureUploadedModelsDir,
    publishModel,
  };
}
