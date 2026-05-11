// Browser-safe entry. Only client-side code (no `node:*` imports).
// Server-side code (RealtimeServer, WsClient, etc.) lives at
// `@officexr/realtime-server/server` so the browser bundle doesn't pull
// in `node:http` / `ws` transitively.
export * from './protocol.ts';
export * from './ws-channel.ts';
