import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createSessionReader, parseCookieDomain, parseFrontendOrigins, pgAllowlist, pgSessionStore } from '@officexr/server';
import { listen } from '@officexr/server/listen';
import { DEFAULT_MODELS_DIR } from '@officexr/server/static';
import { createStudioMcpOptions, loopbackDocuments, loopbackOrigin } from '@officexr/studio-mcp/mount-mcp';
import { createStudioStorage, seedDataDir } from '@officexr/world/vite-plugin-storage';
import { createInternalServer, createPublicServer } from './app.ts';
import { ModelSourcesService } from './model-sources/service.ts';
import { AgentTokenService } from './agent-tokens/service.ts';
import { PgAgentTokenRequestStore } from './agent-tokens/store.ts';
import { parseAgentTokenEnv } from './agent-tokens/index.ts';
import { createOAuthApp, parseOAuthEnv } from './oauth/index.ts';
import { PgOAuthStore } from './oauth/store.ts';
import { modelSourceStoreFromEnv } from './model-sources/store.ts';
import { studioBackend } from './studio-backend.ts';
import { cacheAllowlist } from './studio-gate.ts';

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
const oauthEnv = parseOAuthEnv(env);
if (oauthEnv.type === 'invalid') {
  console.error(`[studio-server] ${oauthEnv.problem}`);
  process.exit(1);
}
const agentTokenEnv = parseAgentTokenEnv(env, oauthEnv);
if (agentTokenEnv.type === 'invalid') {
  console.error(`[studio-server] ${agentTokenEnv.problem}`);
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
await backend.ensureUploadedModelsDir();
const storage = createStudioStorage(backend.storageOptions);
await storage.migrate();
backend.startR2Sync();

const modelSources = await modelSourceStoreFromEnv(env);
if (!modelSources) {
  console.log('[studio-server] private model sources are disabled: OFFICEXR_MODEL_SOURCES_BUCKET is not set');
}

const agentTokens =
  agentTokenEnv.type === 'enabled'
    ? new AgentTokenService({
        store: new PgAgentTokenRequestStore(pool),
        secret: agentTokenEnv.secret,
        issuer: agentTokenEnv.issuerUrl,
        studioAppUrl: agentTokenEnv.studioAppUrl,
      })
    : null;
if (!agentTokens) {
  console.log('[studio-server] agent API tokens disabled: set OFFICEXR_STUDIO_API_JWT_SECRET and STUDIO_APP_URL to enable them');
}

const mcp = createStudioMcpOptions({
  modelRoot: fileURLToPath(new URL('../../studio/public', import.meta.url)),
  chromiumPath: env.OFFICEXR_RENDER_CHROMIUM_PATH || undefined,
  sourceReader: modelSources ?? undefined,
});
const modelSourcesService = modelSources
  ? new ModelSourcesService({
      store: modelSources,
      catalog: () => loopbackDocuments(loopbackOrigin(internal.server)).catalog,
      heavyWorkLock: mcp.heavyWorkLock,
      uploadedModelsDir: backend.uploadedModelsDir,
      publishModel: backend.publishModel,
    })
  : null;
const internal = createInternalServer({
  storage,
  modelsDir: DEFAULT_MODELS_DIR,
  uploadedModelsDir: backend.uploadedModelsDir,
  studioDist,
  mcp: { ...mcp, modelSources: modelSourcesService ?? undefined, agentTokens: agentTokens ?? undefined },
  realtimeTarget,
});
const publicServer = createPublicServer({
  storage,
  modelsDir: DEFAULT_MODELS_DIR,
  uploadedModelsDir: backend.uploadedModelsDir,
  realtimeTarget,
  frontendOrigins,
  sessionReader,
  isStudioAllowed: cacheAllowlist(pgAllowlist(pool, 'studio_allowlist')),
  modelSources: modelSourcesService,
  agentTokens,
  oauth:
    oauthEnv.type === 'enabled'
      ? createOAuthApp({ issuerUrl: oauthEnv.issuerUrl, webPublicUrl: oauthEnv.webPublicUrl, store: new PgOAuthStore(pool), isAdmin: cacheAllowlist(pgAllowlist(pool, 'admin_allowlist')), mcp: internal.mcp }).handler
      : undefined,
});
if (oauthEnv.type === 'disabled') {
  console.log('[studio-server] MCP OAuth server disabled: set STUDIO_PUBLIC_URL and OFFICEXR_WEB_PUBLIC_URL to enable it');
}

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
