import type { IncomingMessage, ServerResponse } from 'node:http';
import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import type pg from 'pg';
import type { Connect } from 'vite';
import type { Identity } from './api';

export interface AuthConfig {
  googleClientId: string;
  googleClientSecret: string;
  sessionSecret: string;
  /** External origin, e.g. `https://officexr.example.com`. */
  publicUrl: string;
}

const AUTH_ENV: Record<keyof AuthConfig, string> = {
  googleClientId: 'GOOGLE_CLIENT_ID',
  googleClientSecret: 'GOOGLE_CLIENT_SECRET',
  sessionSecret: 'SESSION_SECRET',
  publicUrl: 'PUBLIC_URL',
};

/** The env var names of the unset fields; empty when `config` is complete. */
export function missingAuthEnv(config: Partial<AuthConfig>): string[] {
  return (Object.keys(AUTH_ENV) as (keyof AuthConfig)[]).filter((key) => !config[key]).map((key) => AUTH_ENV[key]);
}

export type IsLoginAllowed = (email: string) => Promise<boolean>;

export type LoginError = 'unverified' | 'not_allowed' | 'failed';
export interface Refusal {
  loginError: LoginError;
}

type GoogleVerify = (accessToken: string, refreshToken: string, profile: Profile, done: VerifyCallback) => void;
export type GoogleStrategyFactory = (config: AuthConfig, verify: GoogleVerify) => passport.Strategy;

const SESSION_COOKIE = 'officexr.sid';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export async function verifyGoogleProfile(
  profile: Pick<Profile, 'emails' | 'displayName' | '_json'>,
  isLoginAllowed: IsLoginAllowed,
): Promise<Identity | Refusal> {
  const email = profile.emails?.[0]?.value.toLowerCase();
  if (!email || profile._json.email_verified !== true) {
    return { loginError: 'unverified' };
  }
  if (!(await isLoginAllowed(email))) {
    return { loginError: 'not_allowed' };
  }
  return { login: email, name: profile.displayName || email };
}

export const createGoogleStrategy: GoogleStrategyFactory = (config, verify) =>
  new GoogleStrategy(
    {
      clientID: config.googleClientId,
      clientSecret: config.googleClientSecret,
      callbackURL: new URL('/auth/google/callback', config.publicUrl).href,
      pkce: true,
      // `true` selects passport-oauth2's session state store (state + PKCE verifier), which the types don't model.
      store: true as unknown as undefined,
    },
    verify,
  );

export function pgSessionStore(pool: pg.Pool): session.Store {
  // Non-sliding expiry: without it every request with a loaded session writes its expiry back.
  return new (connectPgSimple(session))({ pool, disableTouch: true });
}

export function sessionIdentity(req: IncomingMessage): Identity | null {
  return (req as { user?: Identity }).user ?? null;
}

// Browsers drop tabs and newlines inside URLs (`/\t/evil.com` becomes `//evil.com`) and treat `\` as `/`;
// non-ASCII would make `setHeader('Location')` throw. Real return paths are already percent-encoded.
const UNSAFE_PATH_CHAR = (c: string) => c === '\\' || c < ' ' || c > '~';

/** Accepts only same-origin relative paths, so `next` can't redirect off-site. */
export function safeReturnPath(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && ![...next].some(UNSAFE_PATH_CHAR) ? next : '/';
}

function redirect(res: ServerResponse, location: string) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function chain(handlers: Connect.NextHandleFunction[]): Connect.NextHandleFunction {
  return (req, res, next) => {
    const run = (i: number, err?: unknown): void => {
      if (err || i === handlers.length) {
        return next(err);
      }
      handlers[i](req, res, (e?: unknown) => run(i + 1, e));
    };
    run(0);
  };
}

export interface AuthOptions {
  config: AuthConfig;
  sessionStore: session.Store;
  isLoginAllowed: IsLoginAllowed;
  googleStrategy?: GoogleStrategyFactory;
}

/** Session, passport and the `/auth/*` routes, run only for `/auth/*` and `/api/*` requests. */
export function createAuth({ config, sessionStore, isLoginAllowed, googleStrategy = createGoogleStrategy }: AuthOptions): Connect.NextHandleFunction {
  const secure = new URL(config.publicUrl).protocol === 'https:';
  const auth = new passport.Passport();
  auth.serializeUser((user, done) => done(null, user));
  auth.deserializeUser((user: Identity, done) => done(null, user));
  auth.use(
    'google',
    googleStrategy(config, (_accessToken, _refreshToken, profile, done) => {
      verifyGoogleProfile(profile, isLoginAllowed).then(
        (result) => ('loginError' in result ? done(null, false, result) : done(null, result)),
        (err) => done(err),
      );
    }),
  );

  const routes: Connect.NextHandleFunction = (req, res, next) => {
    const [path, search = ''] = (req.url ?? '').split('?');
    const query = Object.fromEntries(new URLSearchParams(search));
    if (path.startsWith('/auth/google')) {
      // passport-oauth2 reads `code`, `state` and `error` from `req.query`, which only Express sets.
      (req as { query?: unknown }).query = query;
    }
    if (req.method === 'GET' && path === '/auth/google') {
      const returnPath = safeReturnPath(query.next);
      // Kept in the verified OAuth state, not the session: `req.logIn` regenerates the session.
      const options = { scope: ['profile', 'email'], state: { returnPath } as unknown as string };
      return auth.authenticate('google', options)(req, res, next);
    }
    if (req.method === 'GET' && path === '/auth/google/callback') {
      const fail = (loginError: LoginError) => redirect(res, `/?login_error=${loginError}`);
      // A custom callback because `successRedirect`/`failureRedirect` call `res.redirect`, which connect lacks.
      return auth.authenticate('google', (err: unknown, user: Identity | false, info?: Partial<Refusal> & { state?: { returnPath?: unknown } }) => {
        if (err) {
          console.error(err);
          return fail('failed');
        }
        if (!user) {
          return fail(info?.loginError ?? 'failed');
        }
        (req as unknown as Express.Request).logIn(user, (loginErr) => {
          if (loginErr) {
            console.error(loginErr);
            return fail('failed');
          }
          redirect(res, safeReturnPath(info?.state?.returnPath));
        });
      })(req, res, next);
    }
    if (req.method === 'POST' && path === '/auth/logout') {
      const request = req as unknown as Express.Request;
      return request.logout((logoutErr) => {
        if (logoutErr) {
          return next(logoutErr);
        }
        request.session.destroy((destroyErr) => {
          if (destroyErr) {
            return next(destroyErr);
          }
          res.statusCode = 204;
          res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
          res.end();
        });
      });
    }
    next();
  };

  const handle = chain([
    session({
      name: SESSION_COOKIE,
      store: sessionStore,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_MAX_AGE_MS },
    }) as unknown as Connect.NextHandleFunction,
    auth.initialize() as unknown as Connect.NextHandleFunction,
    auth.session() as unknown as Connect.NextHandleFunction,
    routes,
  ]);
  return (req, res, next) => {
    const url = req.url ?? '';
    return url.startsWith('/auth/') || url.startsWith('/api/') ? handle(req, res, next) : next();
  };
}
