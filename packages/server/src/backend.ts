import { createOfficeApi } from '@officexr/realtime-server/office-api';
import { RealtimeServer } from '@officexr/realtime-server/server';
import type connect from 'connect';
import { createApp, type AppOptions } from './app';
import { authConfigFromEnv, parseCookieDomain } from './auth';
import { parseFrontendOrigins } from './cors';
import { createDb } from './db';

export interface BackendOptions {
  dev?: AppOptions['dev'];
  adminToken?: string;
  worldConstantsUrl?: string;
  /** Origin the realtime server calls this app's API on, e.g. `http://127.0.0.1:4173`. */
  apiUrl: string;
}

export interface Backend {
  app: connect.Server;
  /** Not yet attached; the caller attaches it to the server that serves `app`. */
  realtime: RealtimeServer;
  /** Ends the database pool; call it after the servers have closed. */
  closePool: () => Promise<void>;
}

/** The app and realtime server, wired to the database and Google sign-in configured in `env`. */
export async function createBackend(env: Record<string, string | undefined>, { dev, adminToken, worldConstantsUrl, apiUrl }: BackendOptions): Promise<Backend> {
  const auth = authConfigFromEnv(env);
  const frontendOrigins = parseFrontendOrigins(env.FRONTEND_ORIGINS);
  const cookieDomain = parseCookieDomain(env.COOKIE_DOMAIN, URL.parse(auth.publicUrl ?? '')?.hostname ?? '');
  const db = createDb(env.SUPABASE_DB_URL);
  const officeApi = createOfficeApi({ baseUrl: apiUrl, tokenSecret: env.OFFICEXR_REALTIME_TOKEN_SECRET });
  const realtime = new RealtimeServer({
    tokenSecret: env.OFFICEXR_REALTIME_TOKEN_SECRET,
    adminToken,
    worldConstantsUrl,
    sessionPolicy: (officeId, login) => officeApi.allowsMultiSession(officeId, login),
  });
  const app = await createApp({
    ...db,
    auth,
    frontendOrigins,
    cookieDomain,
    realtime,
    realtimeTokenSecret: env.OFFICEXR_REALTIME_TOKEN_SECRET,
    studioDataDir: env.OFFICEXR_STUDIO_DATA_DIR,
    dev,
  });
  return { app, realtime, closePool: db.close };
}
