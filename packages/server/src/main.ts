import { createServer } from 'node:http';
import { createBackend } from './backend';
import { close, listen } from './listen';

const env = process.env;
const port = Number(env.PORT) || 4173;
const adminPort = Number(env.ADMIN_PORT) || 8787;
const { app, realtime, closePool } = await createBackend(env, {
  adminToken: env.OFFICEXR_REALTIME_ADMIN_TOKEN,
  worldConstantsUrl: env.OFFICEXR_WORLD_CONSTANTS_URL ?? `http://127.0.0.1:${port}/api/world-settings`,
});

const server = createServer(app);
realtime.attach(server);
const adminServer = createServer((req, res) => {
  realtime.adminHandler(req, res, () => {
    res.writeHead(404).end();
  });
});
await Promise.all([listen(server, port), listen(adminServer, adminPort)]);
console.log(`[server] listening on :${port}, admin on :${adminPort}`);

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  realtime
    .stop()
    .then(() => Promise.all([close(server), close(adminServer)]))
    .then(closePool)
    .then(
      () => process.exit(0),
      (err) => {
        console.error('[server] shutdown failed:', err);
        process.exit(1);
      },
    );
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
