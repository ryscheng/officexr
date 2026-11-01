/**
 * Connection settings for the custom realtime WebSocket server (the
 * `@officexr/realtime-server` package). The browser defaults to the
 * same origin as the page so the Vite dev-server proxy carries the
 * traffic — this lets remote developers point their browser at the
 * Vite host without needing a direct route to the realtime server.
 * The Node bots CLI runs on the same machine as the server and talks
 * directly to it.
 */

import { STUDIO_API_ORIGIN, studioFetch } from '../apiOrigin.ts';

const LOCAL_DEFAULT_HOST = 'http://127.0.0.1:8787';
const DEFAULT_PATH = '/ws';

export interface RealtimeConfig {
  /** Full WebSocket URL the channel connects to. */
  url: string;
  /** Full HTTP URL of the server's health endpoint. */
  healthUrl: string;
  /** Office id baked into the authoritative store on the server. */
  officeId: string;
}

function originHttpToWs(origin: string): string {
  return origin.replace(/^http/, 'ws');
}

/**
 * Resolve config for the browser. Defaults to `${origin}/ws` /
 * `${origin}/health` on the studio API origin when set; otherwise on the
 * page's origin, so the Vite proxy carries the traffic.
 * `VITE_REALTIME_URL` / `VITE_HEALTH_URL` override.
 */
export function browserRealtimeConfig(): RealtimeConfig {
  const env: Record<string, string | undefined> = import.meta.env ?? {};
  const origin =
    STUDIO_API_ORIGIN ||
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : LOCAL_DEFAULT_HOST);
  return {
    url: env.VITE_REALTIME_URL ?? `${originHttpToWs(origin)}${DEFAULT_PATH}`,
    healthUrl: env.VITE_HEALTH_URL ?? `${origin}/health`,
    officeId: env.VITE_OFFICE_ID ?? 'debug-office',
  };
}

/** Probe `/health` on the realtime server. Used by the page's
 * promotion path to decide whether to fall back with an error banner
 * if the bots CLI isn't running. */
export async function isRealtimeServerAvailable(
  healthUrl: string,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // Only the studio API needs the session; credentials to another server would fail its CORS.
    const probe = STUDIO_API_ORIGIN && healthUrl.startsWith(`${STUDIO_API_ORIGIN}/`) ? studioFetch : fetch;
    const res = await probe(healthUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}
