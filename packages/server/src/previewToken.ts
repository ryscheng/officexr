import { createHmac } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { isLogin } from '@officexr/realtime-server/join-token';
import type { Identity } from './shared';
import { PREVIEW_TOKEN_PARAM } from './previewTokenBrowser';

const AUDIENCE = 'officexr-preview';
export const PREVIEW_TOKEN_TTL_SECONDS = 10 * 60;
const CLOCK_TOLERANCE_SECONDS = 5;

/**
 * Short-lived HS256 JWTs standing in for the session cookie on allowlisted frontends the cookie can't reach, such as
 * Cloudflare Pages previews on `*.pages.dev`: the browser treats requests from them as cross-site, so the
 * `SameSite=Lax` cookie is never sent. Signed with a key derived from `SESSION_SECRET`, so no new secret is needed
 * and a session cookie signature can't double as a token.
 */
export class PreviewTokens {
  private readonly key: Uint8Array;
  private readonly issuer: string;
  private readonly now: () => Date;

  constructor({ sessionSecret, issuer, now = () => new Date() }: { sessionSecret: string; issuer: string; now?: () => Date }) {
    this.key = createHmac('sha256', sessionSecret).update('officexr preview token v1').digest();
    this.issuer = issuer;
    this.now = now;
  }

  sign(identity: Identity): Promise<string> {
    const issuedAt = Math.floor(this.now().getTime() / 1000);
    return new SignJWT({ name: identity.name })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(identity.login)
      .setIssuer(this.issuer)
      .setAudience(AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + PREVIEW_TOKEN_TTL_SECONDS)
      .sign(this.key);
  }

  /** The identity `token` vouches for, or `null` if it is malformed, forged, expired or minted for something else. */
  async verify(token: string): Promise<Identity | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: AUDIENCE,
        requiredClaims: ['exp', 'sub'],
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: this.now(),
      });
      const login = payload.sub;
      if (!isLogin(login)) {
        return null;
      }
      return { login, name: typeof payload.name === 'string' && payload.name ? payload.name : login };
    } catch {
      return null;
    }
  }
}

/**
 * Whether a page on `origin` sends the session cookie to the backend: true when its host is on or under `cookieScope`
 * (`COOKIE_DOMAIN`, or the backend's own host without one), which makes it same-site with the backend.
 */
export function cookieReaches(origin: URL, cookieScope: string): boolean {
  const host = origin.hostname;
  return host === cookieScope || host.endsWith(`.${cookieScope}`);
}

/** `target` with a fresh preview token in its fragment, replacing any fragment it had. */
export function withPreviewToken(target: URL, token: string): string {
  const url = new URL(target);
  url.hash = `${PREVIEW_TOKEN_PARAM}=${token}`;
  return url.href;
}
