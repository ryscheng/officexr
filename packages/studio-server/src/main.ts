import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listen } from '@officexr/server/listen';
import { DEFAULT_MODELS_DIR } from '@officexr/server/static';
import { createStudioMcpOptions } from '@officexr/studio-mcp/mount-mcp';
import { createStudioStorage, seedDataDir } from '@officexr/world/vite-plugin-storage';
import { createInternalServer, createPublicServer } from './app.ts';
import { studioBackend } from './studio-backend.ts';

const env = process.env;
const port = Number(env.PORT) || 5174;
const publicPort = Number(env.PUBLIC_PORT) || 5175;
const realtimeTarget = env.REALTIME_SERVER_TARGET ?? 'http://127.0.0.1:8787';
const studioDist = fileURLToPath(new URL('../../studio/dist', import.meta.url));
const backend = studioBackend(env);

if (!(await access(path.join(studioDist, 'index.html')).then(() => true, () => false))) {
  console.error(`[studio-server] ${studioDist} has no build; run \`pnpm --filter @officexr/studio build\` first`);
  process.exit(1);
}
if (backend.dataDir) {
  await seedDataDir(backend.dataDir);
}
const storage = createStudioStorage(backend.storageOptions);
await storage.migrate();
backend.startR2Sync();

const internal = createInternalServer({
  storage,
  modelsDir: DEFAULT_MODELS_DIR,
  studioDist,
  mcp: createStudioMcpOptions({
    modelRoot: fileURLToPath(new URL('../../studio/public', import.meta.url)),
    chromiumPath: env.OFFICEXR_RENDER_CHROMIUM_PATH || undefined,
  }),
  realtimeTarget,
});
// ponytail: unauthenticated until the studio auth gate lands — do not expose PUBLIC_PORT outside the cluster.
const publicServer = createPublicServer({ storage, modelsDir: DEFAULT_MODELS_DIR, realtimeTarget });

await Promise.all([listen(internal.server, port), listen(publicServer.server, publicPort)]);
console.log(`[studio-server] internal on :${port}, public on :${publicPort}`);

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  Promise.all([internal.close(), publicServer.close()]).then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
