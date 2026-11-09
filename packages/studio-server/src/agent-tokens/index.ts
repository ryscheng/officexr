import type { OAuthEnv } from '../oauth/index.ts';

export type AgentTokenEnv =
  | { type: 'disabled' }
  | { type: 'enabled'; secret: string; studioAppUrl: string; issuerUrl: string }
  | { type: 'invalid'; problem: string };

const MIN_SECRET_BYTES = 32;

/** Agent tokens need `OFFICEXR_STUDIO_API_JWT_SECRET` and `STUDIO_APP_URL` together, and the MCP OAuth server they are requested through. */
export function parseAgentTokenEnv(env: Record<string, string | undefined>, oauthEnv: OAuthEnv): AgentTokenEnv {
  const secret = env.OFFICEXR_STUDIO_API_JWT_SECRET?.trim();
  const rawAppUrl = env.STUDIO_APP_URL?.trim();
  if (!secret && !rawAppUrl) {
    return { type: 'disabled' };
  }
  if (!secret || !rawAppUrl) {
    return { type: 'invalid', problem: 'agent API tokens need both OFFICEXR_STUDIO_API_JWT_SECRET and STUDIO_APP_URL' };
  }
  if (Buffer.byteLength(secret) < MIN_SECRET_BYTES) {
    return { type: 'invalid', problem: `OFFICEXR_STUDIO_API_JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes` };
  }
  const appUrl = URL.parse(rawAppUrl);
  if (!appUrl || !/^https?:$/.test(appUrl.protocol)) {
    return { type: 'invalid', problem: 'STUDIO_APP_URL must be an http(s) URL' };
  }
  if (oauthEnv.type !== 'enabled') {
    return { type: 'invalid', problem: 'agent API tokens need the MCP OAuth server: set STUDIO_PUBLIC_URL and OFFICEXR_WEB_PUBLIC_URL' };
  }
  return { type: 'enabled', secret, studioAppUrl: rawAppUrl.replace(/\/$/, ''), issuerUrl: oauthEnv.issuerUrl };
}
