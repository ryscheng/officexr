/**
 * JaaS (Jitsi as a Service) JWT generation using the Web Crypto API.
 *
 * JaaS requires a signed RS256 JWT for authenticated room access.
 * Signing is done entirely in the browser — no server round-trip needed.
 *
 * Required env vars:
 *   VITE_JAAS_APP_ID       — your JaaS App ID (vpaas-magic-cookie-…)
 *   VITE_JAAS_API_KEY_ID   — the Key ID shown in the JaaS console for this key
 *   VITE_JAAS_PRIVATE_KEY  — RSA private key in PKCS#8 PEM format (the full
 *                            "-----BEGIN PRIVATE KEY-----…" block). In .env
 *                            files use double quotes and literal \n escapes.
 */

export interface JaaSUserInfo {
  id: string;
  name: string;
  email: string;
}

/** Base64-URL encode a string or raw ArrayBuffer (no padding). */
function b64url(input: string | ArrayBuffer): string {
  let bytes: Uint8Array;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else {
    bytes = new Uint8Array(input);
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strip PEM headers/footers and whitespace, return raw base64 bytes. */
function pemToArrayBuffer(pem: string): ArrayBuffer {
  // Env vars stored with literal \n escapes need to be unescaped first
  const normalized = pem.replace(/\\n/g, '\n');
  const b64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
  return buf.buffer;
}

/**
 * Generate a signed JaaS JWT valid for `ttlSeconds` (default: 7 days).
 * Throws if the private key cannot be imported or signing fails.
 */
export async function generateJaaSJwt(
  appId: string,
  apiKeyId: string,
  privateKeyPem: string,
  user: JaaSUserInfo,
  ttlSeconds = 7 * 24 * 60 * 60,
): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', kid: apiKeyId, typ: 'JWT' };
  const payload = {
    iss: 'chat',
    iat: now,
    exp: now + ttlSeconds,
    nbf: now - 10,
    // '*' allows joining any room under this app
    room: '*',
    sub: appId,
    context: {
      user: {
        moderator: 'true',
        name: user.name,
        id: user.id,
        avatar: '',
        email: user.email,
      },
      features: {
        livestreaming: 'false',
        recording: 'false',
        transcription: 'false',
        'outbound-call': 'false',
      },
    },
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${b64url(signature)}`;
}
