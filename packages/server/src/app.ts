import { fileURLToPath } from 'node:url';
import connect from 'connect';
import type { RealtimeServer } from '@officexr/realtime-server/server';
import { createStudioStorage, studioMapExists } from '@officexr/world/vite-plugin-storage';
import type { Store } from 'express-session';
import { apiMiddleware, type CreateOffice, type OfficeCharacters, type QueryOffices, type UpdateOffice } from './api';
import { createAuth, parseAuthConfig, sessionIdentity, type AuthConfig, type GoogleStrategyFactory, type IsLoginAllowed } from './auth';
import { configJsMiddleware } from './runtimeConfig';
import type { Identity } from './shared';
import { staticDirMiddleware } from './staticDir';

const DEFAULT_MODELS_DIR = fileURLToPath(new URL('../../studio/public/models', import.meta.url));

export interface AppOptions {
  queryOffices: QueryOffices;
  characters: OfficeCharacters;
  createOffice: CreateOffice;
  updateOffice: UpdateOffice;
  isLoginAllowed: IsLoginAllowed;
  /** Required unless `dev` is set; in dev, sign-in is mounted only when every field is set. */
  auth: Partial<AuthConfig>;
  /** Called once per app, so building the options never connects to the database. */
  sessionStore: () => Store;
  googleStrategy?: GoogleStrategyFactory;
  realtime: Pick<RealtimeServer, 'requestHandler'>;
  /** Must equal the realtime server's `OFFICEXR_REALTIME_TOKEN_SECRET`; unset disables `/api/realtime-token`. */
  realtimeTokenSecret?: string;
  /** Studio data dir served read-only under `/api`; the storage defaults when unset. */
  studioDataDir?: string;
  /** Character and object models served at `/models`. Default: the studio's `public/models`. */
  modelsDir?: string;
  /** Local dev only: `user` is the identity of every request, and `env` is served at `/config.js` too. */
  dev?: { user?: Identity; env?: Record<string, string> };
}

export async function createApp({
  queryOffices,
  characters,
  createOffice,
  updateOffice,
  isLoginAllowed,
  auth,
  sessionStore,
  googleStrategy,
  realtime,
  realtimeTokenSecret,
  studioDataDir,
  modelsDir = DEFAULT_MODELS_DIR,
  dev,
}: AppOptions): Promise<connect.Server> {
  const parsedAuth = parseAuthConfig(auth);
  const devUser = dev?.user;
  if (parsedAuth.type === 'invalid' && !dev) {
    throw new Error(`Google sign-in is not configured; set a valid ${parsedAuth.envNames.join(', ')}`);
  }
  const app = connect();
  const storage = createStudioStorage({ dataDir: studioDataDir, readOnly: true });
  await storage.migrate();
  // Before `apiMiddleware`, which answers every other `/api/*` path with a 404.
  storage.mount(app);
  if (parsedAuth.type === 'valid') {
    for (const middleware of createAuth({ config: parsedAuth.config, sessionStore: sessionStore(), isLoginAllowed, googleStrategy })) {
      app.use(middleware);
    }
  } else if (!devUser) {
    console.warn(`Neither OFFICEXR_DEV_USER_LOGIN nor Google sign-in (${parsedAuth.envNames.join(', ')}) is set; identity routes will return 401.`);
  }
  app.use(staticDirMiddleware('/models', modelsDir));
  app.use(configJsMiddleware(dev?.env));
  app.use(realtime.requestHandler);
  app.use(
    apiMiddleware(queryOffices, characters, createOffice, updateOffice, studioMapExists(studioDataDir), devUser ? () => devUser : sessionIdentity, realtimeTokenSecret),
  );
  return app;
}
