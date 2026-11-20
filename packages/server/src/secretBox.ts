import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MIN_SECRET_LENGTH = 16;

export interface SecretBox {
  /** `context` is bound as AAD, so a value copied to another login does not decrypt. */
  encrypt: (plaintext: string, context: string) => string;
  decrypt: (sealed: string, context: string) => string;
}

export function createSecretBox(secret: string): SecretBox {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`The encryption secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const key = Buffer.from(hkdfSync('sha256', secret, 'officexr-secret-box', 'aes-256-gcm', 32));
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return [VERSION, ...[iv, cipher.getAuthTag(), body].map((part) => part.toString('base64url'))].join('.');
    },
    decrypt(sealed, context) {
      const [version, iv, tag, body, ...rest] = sealed.split('.');
      const tagBytes = Buffer.from(tag ?? '', 'base64url');
      if (version !== VERSION || !iv || body === undefined || rest.length || tagBytes.length !== TAG_BYTES) {
        throw new Error('Unrecognized sealed value');
      }
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(tagBytes);
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
}
