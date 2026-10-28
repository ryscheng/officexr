import { RealtimeServer } from './server.ts';

const port = Number(process.env.REALTIME_PORT || 8787);
const server = new RealtimeServer({
  port,
  worldConstantsUrl: process.env.OFFICEXR_WORLD_CONSTANTS_URL,
  adminToken: process.env.OFFICEXR_REALTIME_ADMIN_TOKEN,
  officeUrl: process.env.OFFICEXR_OFFICE_URL,
  tokenSecret: process.env.OFFICEXR_REALTIME_TOKEN_SECRET,
});
await server.start();
console.log(`[realtime-server] listening on :${port}`);

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.stop().then(
    () => process.exit(0),
    (err) => {
      console.error('[realtime-server] shutdown failed:', err);
      process.exit(1);
    },
  );
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
