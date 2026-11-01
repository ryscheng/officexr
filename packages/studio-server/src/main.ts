import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createSessionReader, parseCookieDomain, parseFrontendOrigins, pgAllowlist, pgSessionStore } from '@officexr/server';
import { listen } from '@officexr/server/listen';
import { DEFAULT_MODELS_DIR } from '@officexr/server/static';
import { createStudioMcpOptions } from '@officexr/studio-mcp/mount-mcp';
import { createStudioStorage, seedDataDir } from '@officexr/world/vite-plugin-storage';
import { createInternalServer, createPublicServer } from './app.ts';
import { studioBackend } from './studio-backend.ts';
import { cacheIsStudioAllowed } from './studio-gate.ts';

const env = process.env;
const port = Number(env.PORT) || 5174;
const publicPort = Number(env.PUBLIC_PORT) || 5175;
const realtimeTarget = env.REALTIME_SERVER_TARGET ?? 'http://127.0.0.1:8787';
const studioDist = fileURLToPath(new URL('../../studio/dist', import.meta.url));
const backend = studioBackend(env);

if (!env.SESSION_SECRET || !env.SUPABASE_DB_URL) {
  console.error('[studio-server] SESSION_SECRET and SUPABASE_DB_URL must be set: the public port requires sign-in');
  process.exit(1);
}
const frontendOrigins = parseFrontendOrigins(env.FRONTEND_ORIGINS);
// There is no PUBLIC_URL here, so the cookie settings follow the first frontend origin.
const studioOrigin = URL.parse(frontendOrigins[0] ?? '');
// Bounded so a hung database fails requests instead of holding them open.
const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL, connectionTimeoutMillis: 5000 });
pool.on('error', (err) => console.error(err));
const sessionReader = createSessionReader({
  sessionSecret: env.SESSION_SECRET,
  sessionStore: pgSessionStore(pool),
  cookieDomain: parseCookieDomain(env.COOKIE_DOMAIN, studioOrigin?.hostname ?? ''),
  secure: studioOrigin?.protocol === 'https:',
});

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
const publicServer = createPublicServer({
  storage,
  modelsDir: DEFAULT_MODELS_DIR,
  realtimeTarget,
  frontendOrigins,
  sessionReader,
  isStudioAllowed: cacheIsStudioAllowed(pgAllowlist(pool, 'studio_allowlist')),
});

await Promise.all([listen(internal.server, port), listen(publicServer.server, publicPort)]);
console.log(`[studio-server] internal on :${port}, public on :${publicPort}`);

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  Promise.all([internal.close(), publicServer.close()])
    .then(() => pool.end())
    .finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
