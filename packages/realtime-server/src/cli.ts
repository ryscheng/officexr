import { RealtimeServer } from './server.ts';

const port = Number(process.env.REALTIME_PORT || 8787);
const server = new RealtimeServer({ port });
await server.start();
console.log(`[realtime-server] listening on :${port}`);

const shutdown = (): void => {
  void server.stop().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
