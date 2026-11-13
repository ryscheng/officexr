import { createHash, createPrivateKey, type KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';
import type { Identity, Office } from './shared';

/** JaaS (Jitsi as a Service) signing settings. Server-only: the private key must never reach a browser. */
export interface JaasConfig {
  appId: string;
  apiKeyId: string;
  privateKey: KeyObject;
}

/** Short-lived: the client fetches a fresh token whenever it joins a call after this one nears expiry. */
export const JAAS_TOKEN_TTL_SECONDS = 60 * 60;

/** Accepts a PEM (optionally with literal `\n` escapes, as env files store it) or the base64 of one. */
function parsePrivateKey(raw: string): KeyObject {
  const trimmed = raw.trim();
  const pem = trimmed.startsWith('-----BEGIN') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  return createPrivateKey(pem.replace(/\\n/g, '\n'));
}

/**
 * The JaaS signing settings in `env`, or `undefined` (voice off) when any is unset or the key doesn't parse.
 * A bad key logs an error and turns voice off rather than failing boot, as the browser-signed voice did.
 */
export function jaasConfigFromEnv(env: Record<string, string | undefined>): JaasConfig | undefined {
  const appId = env.VITE_JAAS_APP_ID;
  // ponytail: VITE_JAAS_API_KEY_ID / VITE_JAAS_PRIVATE_KEY are deprecated fallbacks so an existing deploy keeps
  // voice working while it moves to OFFICEXR_JAAS_*; remove them one release after the env is migrated.
  const apiKeyId = env.OFFICEXR_JAAS_API_KEY_ID || env.VITE_JAAS_API_KEY_ID;
  const rawKey = env.OFFICEXR_JAAS_PRIVATE_KEY || env.VITE_JAAS_PRIVATE_KEY;
  if (!appId || !apiKeyId || !rawKey) {
    return undefined;
  }
  if (!env.OFFICEXR_JAAS_PRIVATE_KEY || !env.OFFICEXR_JAAS_API_KEY_ID) {
    console.warn('[jaas] VITE_JAAS_API_KEY_ID / VITE_JAAS_PRIVATE_KEY are deprecated; set OFFICEXR_JAAS_API_KEY_ID / OFFICEXR_JAAS_PRIVATE_KEY instead.');
  }
  try {
    return { appId, apiKeyId, privateKey: parsePrivateKey(rawKey) };
  } catch {
    // The parser's error text could quote key material, so only this fixed message is logged.
    console.error('[jaas] OFFICEXR_JAAS_PRIVATE_KEY is not a valid PEM private key (or base64 of one); voice is off.');
    return undefined;
  }
}

/** Opaque, stable per login, so the JaaS user id doesn't reveal the sign-in email to other participants. */
export const jaasUserId = (login: string) => createHash('sha256').update(login).digest('hex').slice(0, 32);

export interface JaasToken {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

/**
 * Mints a JaaS JWT for `me` in `office`. Every claim comes from the session and the server's office record,
 * never from the request.
 */
export async function signJaasToken(config: JaasConfig, me: Identity, _office: Office, now = Date.now()): Promise<JaasToken> {
  const iat = Math.floor(now / 1000);
  const exp = iat + JAAS_TOKEN_TTL_SECONDS;
  const token = await new SignJWT({
    // '*': the client joins a different Jitsi room per proximity zone (hashed names, see `jitsiRoomName`), and
    // JaaS can't scope a token to a room prefix, so it covers every room under this app.
    room: '*',
    context: {
      user: {
        // Everyone is moderator, as before server-side signing; narrowing it (e.g. to the office creator) is a
        // product decision, since Jitsi moderators can mute and kick.
        moderator: true,
        name: me.name,
        id: jaasUserId(me.login),
        avatar: '',
        email: '',
      },
      features: {
        livestreaming: 'false',
        recording: 'false',
        transcription: 'false',
        'outbound-call': 'false',
      },
    },
  })
    .setProtectedHeader({ alg: 'RS256', kid: config.apiKeyId, typ: 'JWT' })
    .setIssuer('chat')
    .setAudience('jitsi')
    .setSubject(config.appId)
    .setIssuedAt(iat)
    .setNotBefore(iat - 60)
    .setExpirationTime(exp)
    .sign(config.privateKey);
  return { token, expiresAt: exp * 1000 };
}
