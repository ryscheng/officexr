import cors from 'cors';
import vary from 'vary';
import type { NextHandleFunction } from 'connect';

const WILDCARD_PREFIX = 'https://*.';
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// `*` is checked explicitly because WHATWG URL parsing accepts it as a host character.
const isCanonicalOrigin = (origin: string) =>
  /^https?:\/\//.test(origin) && !origin.includes('*') && URL.canParse(origin) && new URL(origin).origin === origin;

/** `https://*.example.pages.dev`: the wildcard is the whole leftmost label, and at least two labels follow it. */
const isWildcardOrigin = (pattern: string) =>
  pattern.startsWith(WILDCARD_PREFIX) &&
  pattern.slice(WILDCARD_PREFIX.length).includes('.') &&
  isCanonicalOrigin(`https://x.${pattern.slice(WILDCARD_PREFIX.length)}`);

/**
 * `FRONTEND_ORIGINS`: comma-separated exact origins (`scheme://host[:port]`, no path), or https wildcards like
 * `https://*.officexr.pages.dev` for Cloudflare Pages preview deployments; unset or empty is `[]`. The first entry
 * is the default landing page, so it must be exact.
 */
export function parseFrontendOrigins(raw: string | undefined): string[] {
  const origins = (raw ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  for (const origin of origins) {
    if (!isCanonicalOrigin(origin) && !isWildcardOrigin(origin)) {
      throw new Error(
        `FRONTEND_ORIGINS must be comma-separated origins like https://app.example.com or https://*.app.pages.dev; got ${JSON.stringify(origin)}`,
      );
    }
  }
  if (origins[0]?.includes('*')) {
    throw new Error(`FRONTEND_ORIGINS must start with an exact origin, since the first is the default landing page; got ${JSON.stringify(origins[0])}`);
  }
  return origins;
}

/**
 * Whether `origin` is one of `allowed` (from `parseFrontendOrigins`). A wildcard entry matches exactly one DNS label,
 * so `https://*.officexr.pages.dev` allows `https://abc123.officexr.pages.dev` but not the bare project host or
 * `https://a.b.officexr.pages.dev`.
 */
export function isAllowedOrigin(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) {
    return false;
  }
  return allowed.some((entry) => {
    const star = entry.indexOf('*');
    if (star === -1) {
      return entry === origin;
    }
    const prefix = entry.slice(0, star);
    const suffix = entry.slice(star + 1);
    return (
      origin.length > prefix.length + suffix.length &&
      origin.startsWith(prefix) &&
      origin.endsWith(suffix) &&
      DNS_LABEL.test(origin.slice(prefix.length, origin.length - suffix.length))
    );
  });
}

/** Credentialed CORS for exactly `origins`; any other origin gets no `Access-Control-*` headers, preflights included. */
export function createCors(origins: string[]): NextHandleFunction {
  const handler = cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  }) as unknown as NextHandleFunction;
  return (req, res, next) => {
    // Always, so a cache never serves one origin's response to another (e.g. the public `/models`).
    vary(res, 'Origin');
    // Checked outside `cors`, which still sends the methods, headers and max-age preflight headers when its origin option refuses.
    return isAllowedOrigin(req.headers.origin, origins) ? handler(req, res, next) : next();
  };
}
