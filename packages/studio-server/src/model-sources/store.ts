import { Storage, type Bucket } from '@google-cloud/storage';
import { GoogleAuth, Impersonated, type AuthClient } from 'google-auth-library';
import { assetContentType } from '@officexr/world/asset-content-type';
import type { ModelSourceReader } from '@officexr/world/model-source';

const UPLOAD_TTL_MS = 15 * 60 * 1000;
/** Extensions a source upload may have; `assetContentType` covers all of them. */
const UPLOAD_EXTENSIONS = new Set(['.glb', '.gltf', '.bin', '.png', '.jpg', '.jpeg', '.webp']);

export interface SignedUpload {
  url: string;
  method: 'PUT';
  /** Exactly the headers the client must send; the signature binds them. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ModelSourceStat {
  sizeBytes: number;
  sha256Meta: string | null;
}

export interface ModelSourceEntry {
  key: string;
  sizeBytes: number;
  updated: Date;
}

/** Private model sources under `packs/<pack>/<path>`. There is deliberately no way to get a read URL. */
export interface ModelSourceStore extends ModelSourceReader {
  /** The content type comes from the key's extension; unsupported extensions are rejected. */
  signUpload(key: string, opts: { sha256: string; sizeBytes: number }): Promise<SignedUpload>;
  stat(key: string): Promise<ModelSourceStat | null>;
  list(prefix: string): Promise<ModelSourceEntry[]>;
}

/** Last line of defence: `packs/<pack>/<path>` with no empty, `.` or `..` segments and no backslashes. */
function assertKey(key: string): void {
  const segments = key.split('/');
  const ok =
    segments.length >= 3 &&
    segments[0] === 'packs' &&
    !key.includes('\\') &&
    segments.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
  if (!ok) {
    throw new Error(`invalid model source key "${key}"`);
  }
}

function uploadContentType(key: string): string {
  const ext = /\.[^./]+$/.exec(key)?.[0].toLowerCase();
  if (!ext || !UPLOAD_EXTENSIONS.has(ext)) {
    throw new Error(`model source "${key}" has an unsupported extension`);
  }
  return assetContentType(key);
}

function metaNumber(value: unknown, what: string, key: string): number {
  const n = Number(value);
  if (value === undefined || value === null || !Number.isFinite(n)) {
    throw new Error(`model source "${key}" has no ${what} metadata`);
  }
  return n;
}

/** Resolves `task`, mapping a 404 to `null`. */
async function orNull<T>(task: Promise<T>): Promise<T | null> {
  try {
    return await task;
  } catch (err) {
    if ((err as { code?: number }).code === 404) {
      return null;
    }
    throw err;
  }
}

export class GcsModelSourceStore implements ModelSourceStore {
  /**
   * @param bucket used for reads, stat and list (ambient credentials).
   * @param signingBucket the same bucket through a client that signs as the signer account.
   */
  constructor(
    private readonly bucket: Pick<Bucket, 'file' | 'getFiles'>,
    private readonly signingBucket: Pick<Bucket, 'file'>,
  ) {}

  async signUpload(key: string, { sha256, sizeBytes }: { sha256: string; sizeBytes: number }) {
    assertKey(key);
    const contentType = uploadContentType(key);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) {
      throw new Error(`invalid upload size ${sizeBytes}`);
    }
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new Error('sha256 must be 64 lowercase hex characters');
    }
    const extensionHeaders = {
      'x-goog-content-length-range': `${sizeBytes},${sizeBytes}`,
      'x-goog-meta-sha256': sha256,
    };
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS);
    const [url] = await this.signingBucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      contentType,
      extensionHeaders,
    });
    return { url, method: 'PUT' as const, headers: { 'content-type': contentType, ...extensionHeaders }, expiresAt };
  }

  async read(key: string): Promise<Uint8Array | null> {
    assertKey(key);
    const res = await orNull(this.bucket.file(key).download());
    return res && res[0];
  }

  async stat(key: string): Promise<ModelSourceStat | null> {
    assertKey(key);
    const res = await orNull(this.bucket.file(key).getMetadata());
    if (!res) {
      return null;
    }
    const sha = res[0].metadata?.sha256;
    return { sizeBytes: metaNumber(res[0].size, 'size', key), sha256Meta: typeof sha === 'string' ? sha : null };
  }

  async list(prefix: string): Promise<ModelSourceEntry[]> {
    if (!prefix.startsWith('packs/') || prefix.split('/').includes('..')) {
      throw new Error(`invalid model source prefix "${prefix}"`);
    }
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((f) => ({
      key: f.name,
      sizeBytes: metaNumber(f.metadata.size, 'size', f.name),
      updated: new Date(metaNumber(Date.parse(String(f.metadata.updated)), 'updated', f.name)),
    }));
  }
}

/**
 * Builds the store whose upload URLs are signed as `signerEmail`: `sourceClient` impersonates it through IAM
 * `signBlob`, so no key is needed. Reads, stat and list keep the ambient credentials.
 */
export function createGcsModelSourceStore(bucketName: string, signerEmail: string, sourceClient: AuthClient) {
  const signer = new Impersonated({ sourceClient, targetPrincipal: signerEmail });
  return new GcsModelSourceStore(
    new Storage().bucket(bucketName),
    new Storage({ authClient: signer }).bucket(bucketName),
  );
}

/** Reads `OFFICEXR_MODEL_SOURCES_BUCKET` + `OFFICEXR_MODEL_SOURCES_SIGNER_EMAIL`; `null` when neither is set. */
export async function modelSourceStoreFromEnv(env: NodeJS.ProcessEnv): Promise<ModelSourceStore | null> {
  const bucketName = env.OFFICEXR_MODEL_SOURCES_BUCKET?.trim();
  const signerEmail = env.OFFICEXR_MODEL_SOURCES_SIGNER_EMAIL?.trim();
  if (!bucketName && !signerEmail) {
    return null;
  }
  if (!bucketName || !signerEmail) {
    throw new Error('OFFICEXR_MODEL_SOURCES_BUCKET and OFFICEXR_MODEL_SOURCES_SIGNER_EMAIL must be set together');
  }
  const sourceClient = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  return createGcsModelSourceStore(bucketName, signerEmail, sourceClient);
}
