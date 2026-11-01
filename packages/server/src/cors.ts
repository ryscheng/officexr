import cors from 'cors';
import type { NextHandleFunction } from 'connect';

/** `FRONTEND_ORIGINS`: comma-separated exact origins (`scheme://host[:port]`, no path); unset or empty is `[]`. */
export function parseFrontendOrigins(raw: string | undefined): string[] {
  const origins = (raw ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  for (const origin of origins) {
    if (!/^https?:\/\//.test(origin) || !URL.canParse(origin) || new URL(origin).origin !== origin) {
      throw new Error(`FRONTEND_ORIGINS must be comma-separated origins like https://app.example.com; got ${JSON.stringify(origin)}`);
    }
  }
  return origins;
}

/** Credentialed CORS for exactly `origins`; any other origin gets no `Access-Control-*` headers, preflights included. */
export function createCors(origins: string[]): NextHandleFunction {
  const allowed = new Set(origins);
  const handler = cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  }) as unknown as NextHandleFunction;
  // The package emits preflight headers even for a refused origin, so refused origins skip it entirely.
  return (req, res, next) => (allowed.has(req.headers.origin ?? '') ? handler(req, res, next) : next());
}
