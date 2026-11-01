import type { Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createStudioMcpOptions } from '@officexr/studio-mcp/mount-mcp';
import { createStudioStorage, seedDataDir } from '@officexr/world/vite-plugin-storage';
import { createInternalServer, createPublicServer } from './app.ts';
import { STUDIO_MODELS_DIR, studioBackend } from './studio-backend.ts';

const env = process.env;
const port = Number(env.PORT) || 5174;
const publicPort = Number(env.PUBLIC_PORT) || 5175;
const backend = studioBackend(env);

if (backend.dataDir) {
  await seedDataDir(backend.dataDir);
}
const storage = createStudioStorage(backend.storageOptions);
await storage.migrate();
backend.startR2Sync();

const internal = createInternalServer({
  storage,
  modelsDir: STUDIO_MODELS_DIR,
  studioDist: fileURLToPath(new URL('../../studio/dist', import.meta.url)),
  mcp: createStudioMcpOptions({
    modelRoot: fileURLToPath(new URL('../../studio/public', import.meta.url)),
    chromiumPath: env.OFFICEXR_RENDER_CHROMIUM_PATH || undefined,
  }),
});
// ponytail: unauthenticated until the studio auth gate lands — do not expose PUBLIC_PORT outside the cluster.
const publicServer = createPublicServer({
  storage,
  modelsDir: STUDIO_MODELS_DIR,
  realtimeTarget: env.REALTIME_SERVER_TARGET ?? 'http://127.0.0.1:8787',
});

// Proxied WebSockets outlive `server.close()`, which would otherwise wait on them forever.
const tunnels = new Set<Duplex>();
publicServer.on('upgrade', (_req, socket: Duplex) => {
  tunnels.add(socket);
  socket.once('close', () => tunnels.delete(socket));
});

const listen = (server: Server, listenPort: number) =>
  new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, () => {
      server.off('error', reject);
      resolve();
    });
  });
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

await Promise.all([listen(internal, port), listen(publicServer, publicPort)]);
console.log(`[studio-server] internal on :${port}, public on :${publicPort}`);

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  const closed = Promise.all([close(internal), close(publicServer)]);
  for (const socket of tunnels) {
    socket.destroy();
  }
  closed.then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
