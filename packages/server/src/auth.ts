import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import connectPgSimple from 'connect-pg-simple';
import { serialize } from 'cookie';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import type pg from 'pg';
import type { NextHandleFunction } from 'connect';
import type { Identity } from './shared';

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

export function authConfigFromEnv(env: Record<string, string | undefined>): Partial<AuthConfig> {
  return Object.fromEntries(Object.entries(AUTH_ENV).map(([key, name]) => [key, env[name]]));
}

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

/** Whether an email, or its domain, is on `table`: a `(kind, value)` allowlist like `login_allowlist`. */
export function pgAllowlist(pool: pg.Pool, table: 'login_allowlist' | 'studio_allowlist'): IsLoginAllowed {
  return async (email) => {
    const { rows } = await pool.query<{ allowed: boolean }>(
      `select exists (select 1 from ${table} where (kind = 'email' and value = $1) or (kind = 'domain' and value = $2)) as allowed`,
      [email, emailDomain(email)],
    );
    return rows[0].allowed;
  };
}

export function pgSessionStore(pool: pg.Pool): session.Store {
  // Non-sliding expiry: without it every request with a loaded session writes its expiry back.
  return new (connectPgSimple(session))({ pool, disableTouch: true });
}

export function sessionIdentity(req: IncomingMessage): Identity | null {
  return (req as { user?: Identity }).user ?? null;
}

/** `COOKIE_DOMAIN` when `host` is that domain or a subdomain of it, else throws; unset or empty is `undefined`. */
export function parseCookieDomain(raw: string | undefined, host: string): string | undefined {
  const domain = raw?.trim().toLowerCase();
  if (!domain) {
    return undefined;
  }
  // Needs a dot so a bare TLD (`com`) can't scope the cookie to every site under it; browsers refuse a Domain on an IP host.
  const isIpHost = isIP(host) !== 0 || host.startsWith('[');
  if (isIpHost || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || !(host === domain || host.endsWith(`.${domain}`))) {
    throw new Error(`COOKIE_DOMAIN must be the host (${host}) or a parent domain of it; got ${JSON.stringify(raw)}`);
  }
  return domain;
}

function sessionCookieOptions(secure: boolean, cookieDomain: string | undefined) {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure, ...(cookieDomain && { domain: cookieDomain }) } as const;
}

export interface SessionReaderOptions {
  sessionSecret: string;
  sessionStore: session.Store;
  cookieDomain?: string;
  secure: boolean;
}

function buildSessionReader({ sessionSecret, sessionStore, cookieDomain, secure }: SessionReaderOptions) {
  const auth = new passport.Passport();
  auth.serializeUser((user, done) => done(null, user));
  auth.deserializeUser((user: Identity, done) => done(null, user));
  const middlewares = [
    session({
      name: SESSION_COOKIE,
      store: sessionStore,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: { ...sessionCookieOptions(secure, cookieDomain), maxAge: SESSION_MAX_AGE_MS },
    }) as unknown as NextHandleFunction,
    auth.initialize() as unknown as NextHandleFunction,
    auth.session() as unknown as NextHandleFunction,
  ];
  return { middlewares, passport: auth };
}

/** Session and passport middleware, with no routes and not path-scoped; `sessionIdentity` then reads the signed-in user. */
export function createSessionReader(options: SessionReaderOptions) {
  return { middlewares: buildSessionReader(options).middlewares, sessionIdentity };
}

// Browsers drop tabs and newlines inside URLs (`/\t/evil.com` becomes `//evil.com`) and treat `\` as `/`;
// non-ASCII would make `setHeader('Location')` throw. Real return paths are already percent-encoded.
const UNSAFE_PATH_CHAR = (c: string) => c === '\\' || c < ' ' || c > '~';

const landingUrl = (origins: string[]) => `${origins[0] ?? ''}/`;

/**
 * `next` if it is a relative path or an absolute http(s) URL on one of `origins`, so it can't redirect off-site;
 * otherwise the default landing page.
 */
export function safeReturnTarget(next: unknown, origins: string[]): string {
  const landing = landingUrl(origins);
  if (typeof next !== 'string' || [...next].some(UNSAFE_PATH_CHAR)) {
    return landing;
  }
  if (next.startsWith('/')) {
    return next.startsWith('//') ? landing : next;
  }
  const url = URL.parse(next);
  // `blob:https://host/` reports the inner origin, so the scheme is checked too.
  const isPlainHttp = url && (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  return isPlainHttp && origins.includes(url.origin) ? url.href : landing;
}

function redirect(res: ServerResponse, location: string) {
  res.statusCode = 302;
  res.setHeader('Location', location);
  res.end();
}

function onlyAuthAndApi(fn: NextHandleFunction): NextHandleFunction {
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
  /** Allowlisted frontend origins; the first is where sign-in lands by default and where failures go. */
  frontendOrigins?: string[];
  cookieDomain?: string;
}

/** Session, passport and the `/auth/*` routes, in order; each runs only for `/auth/*` and `/api/*` requests. */
export function createAuth({
  config,
  sessionStore,
  isLoginAllowed,
  googleStrategy = createGoogleStrategy,
  frontendOrigins = [],
  cookieDomain,
}: AuthOptions): NextHandleFunction[] {
  const secure = new URL(config.publicUrl).protocol === 'https:';
  const reader = buildSessionReader({ sessionSecret: config.sessionSecret, sessionStore, cookieDomain, secure });
  const auth = reader.passport;
  const landing = landingUrl(frontendOrigins);
  // With a cookie domain, browsers keep the old host-only cookie too and send it first, so it must be expired.
  const expireHostOnlyCookie = (res: ServerResponse) => {
    if (cookieDomain) {
      res.appendHeader('Set-Cookie', serialize(SESSION_COOKIE, '', { ...sessionCookieOptions(secure, undefined), expires: new Date(0) }));
    }
  };
  auth.use(
    'google',
    googleStrategy(config, (_accessToken, _refreshToken, profile, done) => {
      verifyGoogleProfile(profile, isLoginAllowed).then(
        (result) => ('loginError' in result ? done(null, false, result) : done(null, result)),
        (err) => done(err),
      );
    }),
  );

  const routes: NextHandleFunction = (req, res, next) => {
    const url = req.url ?? '';
    const queryStart = url.indexOf('?');
    const path = queryStart < 0 ? url : url.slice(0, queryStart);
    const query = Object.fromEntries(new URLSearchParams(queryStart < 0 ? '' : url.slice(queryStart + 1)));
    if (path.startsWith('/auth/google')) {
      // passport-oauth2 reads `code`, `state` and `error` from `req.query`, which only Express sets.
      (req as { query?: unknown }).query = query;
    }
    if (req.method === 'GET' && path === '/auth/google') {
      const returnTo = safeReturnTarget(query.next, frontendOrigins);
      // Kept in the verified OAuth state, not the session: `req.logIn` regenerates the session.
      const options = { scope: ['profile', 'email'], state: { returnTo } as unknown as string };
      return auth.authenticate('google', options)(req, res, next);
    }
    if (req.method === 'GET' && path === '/auth/google/callback') {
      const fail = (loginError: LoginError) => redirect(res, `${landing}?login_error=${loginError}`);
      // A custom callback because `successRedirect`/`failureRedirect` call `res.redirect`, which connect lacks.
      return auth.authenticate('google', (err: unknown, user: Identity | false, info?: Partial<Refusal> & { state?: { returnTo?: unknown } }) => {
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
          expireHostOnlyCookie(res);
          redirect(res, safeReturnTarget(info?.state?.returnTo, frontendOrigins));
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
          res.appendHeader('Set-Cookie', serialize(SESSION_COOKIE, '', { ...sessionCookieOptions(secure, cookieDomain), expires: new Date(0) }));
          expireHostOnlyCookie(res);
          res.end();
        });
      });
    }
    next();
  };

  return [...reader.middlewares, routes].map(onlyAuthAndApi);
}
