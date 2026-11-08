import { Storage, type Bucket } from '@google-cloud/storage';
import { GoogleAuth, Impersonated } from 'google-auth-library';
import type { ModelSourceReader } from '@officexr/world/model-source';

const UPLOAD_TTL_MS = 15 * 60 * 1000;

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
  signUpload(key: string, opts: { sha256: string; sizeBytes: number; contentType: string }): Promise<SignedUpload>;
  stat(key: string): Promise<ModelSourceStat | null>;
  list(prefix: string): Promise<ModelSourceEntry[]>;
}

function assertKey(key: string): void {
  if (!key.startsWith('packs/') || key.split('/').includes('..')) {
    throw new Error(`invalid model source key "${key}"`);
  }
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
    private readonly signingBucket: Pick<Bucket, 'file'> = bucket,
  ) {}

  async signUpload(key: string, { sha256, sizeBytes, contentType }: { sha256: string; sizeBytes: number; contentType: string }) {
    assertKey(key);
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
    return { sizeBytes: Number(res[0].size), sha256Meta: typeof sha === 'string' ? sha : null };
  }

  async list(prefix: string): Promise<ModelSourceEntry[]> {
    assertKey(prefix);
    const [files] = await this.bucket.getFiles({ prefix });
    return files.map((f) => ({
      key: f.name,
      sizeBytes: Number(f.metadata.size),
      updated: new Date(String(f.metadata.updated)),
    }));
  }
}

/**
 * Builds the store from `OFFICEXR_MODEL_SOURCES_BUCKET` + `OFFICEXR_MODEL_SOURCES_SIGNER_EMAIL`; `null` when neither is set.
 * Upload URLs are signed as the signer by impersonating it through IAM `signBlob`, so the pod needs no key.
 */
export async function modelSourceStoreFromEnv(env: NodeJS.ProcessEnv): Promise<ModelSourceStore | null> {
  const bucketName = env.OFFICEXR_MODEL_SOURCES_BUCKET?.trim();
  const signerEmail = env.OFFICEXR_MODEL_SOURCES_SIGNER_EMAIL?.trim();
  if (!bucketName && !signerEmail) {
    return null;
  }
  if (!bucketName || !signerEmail) {
    throw new Error('OFFICEXR_MODEL_SOURCES_BUCKET and OFFICEXR_MODEL_SOURCES_SIGNER_EMAIL must be set together');
  }
  const impersonated = new Impersonated({
    sourceClient: await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient(),
    targetPrincipal: signerEmail,
    targetScopes: ['https://www.googleapis.com/auth/devstorage.read_write'],
  });
  return new GcsModelSourceStore(
    new Storage().bucket(bucketName),
    new Storage({ authClient: impersonated }).bucket(bucketName),
  );
}
