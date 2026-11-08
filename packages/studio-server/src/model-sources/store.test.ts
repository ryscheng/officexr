// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { AuthClient } from 'google-auth-library';
import { GcsModelSourceStore, createGcsModelSourceStore, modelSourceStoreFromEnv } from './store.ts';

const SHA = 'ab'.repeat(32);
const KEY = 'packs/a/m.glb';
const notFound = Object.assign(new Error('No such object'), { code: 404 });

function fakeBucket(file: Record<string, unknown> = {}, files: unknown[] = []) {
  const fileFor = vi.fn(() => file);
  return { file: fileFor, getFiles: vi.fn(async () => [files]) } as never as ConstructorParameters<typeof GcsModelSourceStore>[0] & {
    file: typeof fileFor;
  };
}

function storeWithSigner(getSignedUrl = vi.fn(async () => ['https://signed.example/u'])) {
  const bucket = fakeBucket({ getSignedUrl });
  return { store: new GcsModelSourceStore(bucket, bucket), getSignedUrl };
}

describe('GcsModelSourceStore.signUpload', () => {
  it('signs a v4 write URL binding content type, exact length and sha256, via the signing bucket', async () => {
    const getSignedUrl = vi.fn(async () => ['https://signed.example/u']);
    const ambient = fakeBucket();
    const store = new GcsModelSourceStore(ambient, fakeBucket({ getSignedUrl }));
    const before = Date.now();

    const signed = await store.signUpload(KEY, { sha256: SHA, sizeBytes: 42 });

    expect(ambient.file).not.toHaveBeenCalled();
    const headers = {
      'content-type': 'model/gltf-binary',
      'x-goog-content-length-range': '42,42',
      'x-goog-meta-sha256': SHA,
    };
    expect(signed).toMatchObject({ url: 'https://signed.example/u', method: 'PUT', headers });
    expect(signed.expiresAt.getTime() - before).toBeGreaterThanOrEqual(15 * 60 * 1000);
    expect(signed.expiresAt.getTime() - before).toBeLessThan(15 * 60 * 1000 + 5000);
    expect(getSignedUrl).toHaveBeenCalledWith({
      version: 'v4',
      action: 'write',
      expires: signed.expiresAt,
      contentType: 'model/gltf-binary',
      extensionHeaders: { 'x-goog-content-length-range': '42,42', 'x-goog-meta-sha256': SHA },
    });
  });

  it('derives the content type from the extension and rejects unsupported ones', async () => {
    const { store } = storeWithSigner();
    const gltf = await store.signUpload('packs/a/scene.gltf', { sha256: SHA, sizeBytes: 1 });
    expect(gltf.headers['content-type']).toBe('model/gltf+json');
    await expect(store.signUpload('packs/a/notes.txt', { sha256: SHA, sizeBytes: 1 })).rejects.toThrow('unsupported extension');
    await expect(store.signUpload('packs/a/noext', { sha256: SHA, sizeBytes: 1 })).rejects.toThrow('unsupported extension');
  });

  it('rejects a bad size or sha256 before signing', async () => {
    const { store, getSignedUrl } = storeWithSigner();
    for (const sizeBytes of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      await expect(store.signUpload(KEY, { sha256: SHA, sizeBytes })).rejects.toThrow('invalid upload size');
    }
    for (const sha256 of ['', 'AB'.repeat(32), 'ab'.repeat(31), `${SHA}0`, 'zz'.repeat(32)]) {
      await expect(store.signUpload(KEY, { sha256, sizeBytes: 1 })).rejects.toThrow('sha256');
    }
    expect(getSignedUrl).not.toHaveBeenCalled();
  });
});

describe('GcsModelSourceStore reads', () => {
  it('read returns bytes, null on 404, and throws other errors', async () => {
    const bytes = Buffer.from('glb');
    const bucket = (file: Record<string, unknown>) => new GcsModelSourceStore(fakeBucket(file), fakeBucket());
    expect(await bucket({ download: async () => [bytes] }).read(KEY)).toEqual(bytes);
    expect(await bucket({ download: async () => Promise.reject(notFound) }).read(KEY)).toBeNull();
    const boom = Object.assign(new Error('boom'), { code: 500 });
    await expect(bucket({ download: async () => Promise.reject(boom) }).read(KEY)).rejects.toThrow('boom');
  });

  it('stat surfaces size and the sha256 metadata, null on 404, throws on missing size', async () => {
    const stat = (getMetadata: () => Promise<unknown>) =>
      new GcsModelSourceStore(fakeBucket({ getMetadata }), fakeBucket()).stat(KEY);
    expect(await stat(async () => [{ size: '42', metadata: { sha256: 'ab12' } }])).toEqual({ sizeBytes: 42, sha256Meta: 'ab12' });
    expect(await stat(async () => [{ size: '7' }])).toEqual({ sizeBytes: 7, sha256Meta: null });
    expect(await stat(async () => Promise.reject(notFound))).toBeNull();
    await expect(stat(async () => [{}])).rejects.toThrow('no size metadata');
  });

  it('list maps fields and passes the prefix, throws on missing metadata', async () => {
    const bucket = fakeBucket({}, [{ name: KEY, metadata: { size: '42', updated: '2026-01-02T03:04:05.000Z' } }]);
    expect(await new GcsModelSourceStore(bucket, bucket).list('packs/a/')).toEqual([
      { key: KEY, sizeBytes: 42, updated: new Date('2026-01-02T03:04:05.000Z') },
    ]);
    expect(bucket.getFiles).toHaveBeenCalledWith({ prefix: 'packs/a/' });
    for (const metadata of [{ updated: '2026-01-02T03:04:05.000Z' }, { size: '1' }]) {
      const broken = fakeBucket({}, [{ name: KEY, metadata }]);
      await expect(new GcsModelSourceStore(broken, broken).list('packs/a/')).rejects.toThrow('metadata');
    }
  });

  it('rejects malformed keys', async () => {
    const { store } = storeWithSigner();
    const bad = ['models/x.glb', 'packs/a', 'packs//x.glb', 'packs/a//x.glb', 'packs/./x.glb', 'packs/a/../b/x.glb', 'packs/a\\x.glb', ''];
    for (const key of bad) {
      await expect(store.read(key)).rejects.toThrow('invalid model source key');
      await expect(store.stat(key)).rejects.toThrow('invalid model source key');
      await expect(store.signUpload(key, { sha256: SHA, sizeBytes: 1 })).rejects.toThrow('invalid model source key');
    }
  });
});

describe('createGcsModelSourceStore', () => {
  it('signs as the signer through IAM signBlob on the injected source client', async () => {
    const calls: string[] = [];
    const sourceClient = {
      universeDomain: 'googleapis.com',
      getAccessToken: async () => ({ token: 'source-token' }),
      request: async (opts: { url: string }) => {
        calls.push(opts.url);
        return { data: { keyId: 'k', signedBlob: Buffer.from('sig').toString('base64') } };
      },
    } as unknown as AuthClient;
    const signer = 'signer@proj.iam.gserviceaccount.com';

    const store = createGcsModelSourceStore('bkt', signer, sourceClient);
    const { url } = await store.signUpload(KEY, { sha256: SHA, sizeBytes: 5 });

    const credential = new URL(url).searchParams.get('X-Goog-Credential');
    expect(credential?.startsWith(`${signer}/`)).toBe(true);
    expect(calls).toEqual([`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${signer}:signBlob`]);
  });
});

describe('modelSourceStoreFromEnv', () => {
  it('is null when unconfigured and fails fast when only one var is set', async () => {
    expect(await modelSourceStoreFromEnv({})).toBeNull();
    await expect(modelSourceStoreFromEnv({ OFFICEXR_MODEL_SOURCES_BUCKET: 'b' })).rejects.toThrow('must be set together');
    await expect(modelSourceStoreFromEnv({ OFFICEXR_MODEL_SOURCES_SIGNER_EMAIL: 's@x' })).rejects.toThrow('must be set together');
  });
});
