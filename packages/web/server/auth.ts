import type { IncomingMessage, ServerResponse } from 'node:http';
import connectPgSimple from 'connect-pg-simple';
import { serialize } from 'cookie';
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

export type ParsedAuthConfig = { type: 'valid'; config: AuthConfig } | { type: 'invalid'; envNames: string[] };

/** The complete config, or the env var names that are unset or malformed. */
export function parseAuthConfig(raw: Partial<AuthConfig>): ParsedAuthConfig {
  const isValid = (key: keyof AuthConfig) => (key === 'publicUrl' ? /^https?:$/.test(protocolOf(raw.publicUrl)) : !!raw[key]);
  const envNames = (Object.keys(AUTH_ENV) as (keyof AuthConfig)[]).filter((key) => !isValid(key)).map((key) => AUTH_ENV[key]);
  return envNames.length ? { type: 'invalid', envNames } : { type: 'valid', config: raw as AuthConfig };
}

function protocolOf(url: string | undefined): string {
  return url && URL.canParse(url) ? new URL(url).protocol : '';
}

export type IsLoginAllowed = (email: string) => Promise<boolean>;

/** The part after the last `@`; a quoted local part may itself contain `@`. */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1);
}

type LoginError = 'unverified' | 'not_allowed' | 'failed';
interface Refusal {
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

function onlyAuthAndApi(fn: Connect.NextHandleFunction): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url ?? '';
    return url.startsWith('/auth/') || url.startsWith('/api/') ? fn(req, res, next) : next();
  };
}

interface AuthOptions {
  config: AuthConfig;
  sessionStore: session.Store;
  isLoginAllowed: IsLoginAllowed;
  googleStrategy?: GoogleStrategyFactory;
}

/** Session, passport and the `/auth/*` routes, in order; each runs only for `/auth/*` and `/api/*` requests. */
export function createAuth({ config, sessionStore, isLoginAllowed, googleStrategy = createGoogleStrategy }: AuthOptions): Connect.NextHandleFunction[] {
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(config.publicUrl).protocol === 'https:',
  } as const;
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
    const url = req.url ?? '';
    const queryStart = url.indexOf('?');
    const path = queryStart < 0 ? url : url.slice(0, queryStart);
    const query = Object.fromEntries(new URLSearchParams(queryStart < 0 ? '' : url.slice(queryStart + 1)));
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
          res.setHeader('Set-Cookie', serialize(SESSION_COOKIE, '', { ...cookieOptions, expires: new Date(0) }));
          res.end();
        });
      });
    }
    next();
  };

  return [
    session({
      name: SESSION_COOKIE,
      store: sessionStore,
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: { ...cookieOptions, maxAge: SESSION_MAX_AGE_MS },
    }) as unknown as Connect.NextHandleFunction,
    auth.initialize() as unknown as Connect.NextHandleFunction,
    auth.session() as unknown as Connect.NextHandleFunction,
    routes,
  ].map(onlyAuthAndApi);
}
