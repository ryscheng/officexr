import { createHmac, timingSafeEqual } from 'node:crypto';

export function isLogin(login: unknown): login is string {
  return typeof login === 'string' && login !== '' && !login.includes('#');
}

const sign = (secret: string, payload: string): string => {
  if (secret === '') {
    throw new Error('join token secret must not be empty');
  }
  return createHmac('sha256', secret).update(payload).digest('base64url');
};

/** Mints `base64url({login, exp}).base64url(HMAC-SHA256)`; `now` is epoch ms. */
export function signJoinToken(
  secret: string,
  { login, ttlMs, now = Date.now() }: { login: string; ttlMs: number; now?: number },
): string {
  const payload = Buffer.from(JSON.stringify({ login, exp: now + ttlMs })).toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

/** The login a token vouches for, or `null` if it is malformed, forged, expired or names an invalid login. */
export function verifyJoinToken(secret: string, token: string, now = Date.now()): { login: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payload, signature] = parts;
  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  // timingSafeEqual throws on unequal lengths.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  try {
    const { login, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      login?: unknown;
      exp?: unknown;
    };
    return isLogin(login) && typeof exp === 'number' && now < exp ? { login } : null;
  } catch {
    return null;
  }
}
