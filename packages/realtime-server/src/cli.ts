import { RealtimeServer } from './server.ts';

const port = Number(process.env.REALTIME_PORT ?? 8787);
await new RealtimeServer({ port }).start();
console.log(`[realtime-server] listening on :${port}`);
