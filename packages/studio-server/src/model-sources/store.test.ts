// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GcsModelSourceStore, modelSourceStoreFromEnv } from './store.ts';

const notFound = Object.assign(new Error('No such object'), { code: 404 });

function fakeBucket(file: Record<string, unknown> = {}, files: unknown[] = []) {
  const fileFor = vi.fn(() => file);
  return { file: fileFor, getFiles: vi.fn(async () => [files]) } as never as ConstructorParameters<typeof GcsModelSourceStore>[0] & {
    file: typeof fileFor;
  };
}

describe('GcsModelSourceStore', () => {
  it('signs a v4 write URL that binds content type, exact length and sha256, via the signing bucket', async () => {
    const getSignedUrl = vi.fn(async () => ['https://signed.example/u']);
    const signing = fakeBucket({ getSignedUrl });
    const ambient = fakeBucket();
    const store = new GcsModelSourceStore(ambient, signing);
    const before = Date.now();

    const signed = await store.signUpload('packs/a/m.glb', { sha256: 'ab12', sizeBytes: 42, contentType: 'model/gltf-binary' });

    expect(ambient.file).not.toHaveBeenCalled();
    const headers = {
      'content-type': 'model/gltf-binary',
      'x-goog-content-length-range': '42,42',
      'x-goog-meta-sha256': 'ab12',
    };
    expect(signed).toMatchObject({ url: 'https://signed.example/u', method: 'PUT', headers });
    expect(signed.expiresAt.getTime() - before).toBeGreaterThanOrEqual(15 * 60 * 1000);
    expect(signed.expiresAt.getTime() - before).toBeLessThan(15 * 60 * 1000 + 5000);
    expect(getSignedUrl).toHaveBeenCalledWith({
      version: 'v4',
      action: 'write',
      expires: signed.expiresAt,
      contentType: 'model/gltf-binary',
      extensionHeaders: { 'x-goog-content-length-range': '42,42', 'x-goog-meta-sha256': 'ab12' },
    });
  });

  it('read returns bytes, null on 404, and throws other errors', async () => {
    const bytes = Buffer.from('glb');
    expect(await new GcsModelSourceStore(fakeBucket({ download: async () => [bytes] })).read('packs/a/m.glb')).toEqual(bytes);
    const missing = fakeBucket({ download: async () => Promise.reject(notFound) });
    expect(await new GcsModelSourceStore(missing).read('packs/a/m.glb')).toBeNull();
    const broken = fakeBucket({ download: async () => Promise.reject(Object.assign(new Error('boom'), { code: 500 })) });
    await expect(new GcsModelSourceStore(broken).read('packs/a/m.glb')).rejects.toThrow('boom');
  });

  it('stat surfaces size and the sha256 metadata, null on 404', async () => {
    const present = fakeBucket({ getMetadata: async () => [{ size: '42', metadata: { sha256: 'ab12' } }] });
    expect(await new GcsModelSourceStore(present).stat('packs/a/m.glb')).toEqual({ sizeBytes: 42, sha256Meta: 'ab12' });
    const bare = fakeBucket({ getMetadata: async () => [{ size: '7' }] });
    expect(await new GcsModelSourceStore(bare).stat('packs/a/m.glb')).toEqual({ sizeBytes: 7, sha256Meta: null });
    const missing = fakeBucket({ getMetadata: async () => Promise.reject(notFound) });
    expect(await new GcsModelSourceStore(missing).stat('packs/a/m.glb')).toBeNull();
  });

  it('list maps fields and passes the prefix', async () => {
    const bucket = fakeBucket({}, [{ name: 'packs/a/m.glb', metadata: { size: '42', updated: '2026-01-02T03:04:05.000Z' } }]);
    expect(await new GcsModelSourceStore(bucket).list('packs/a/')).toEqual([
      { key: 'packs/a/m.glb', sizeBytes: 42, updated: new Date('2026-01-02T03:04:05.000Z') },
    ]);
    expect(bucket.getFiles).toHaveBeenCalledWith({ prefix: 'packs/a/' });
  });

  it('rejects keys outside packs/ or with .. segments', async () => {
    const store = new GcsModelSourceStore(fakeBucket());
    await expect(store.read('models/x.glb')).rejects.toThrow('invalid model source key');
    await expect(store.stat('packs/a/../b/x.glb')).rejects.toThrow('invalid model source key');
    await expect(
      store.signUpload('packs/../x', { sha256: 'a', sizeBytes: 1, contentType: 'model/gltf-binary' }),
    ).rejects.toThrow('invalid model source key');
  });
});

describe('modelSourceStoreFromEnv', () => {
  it('is null when unconfigured and fails fast when only one var is set', async () => {
    expect(await modelSourceStoreFromEnv({})).toBeNull();
    await expect(modelSourceStoreFromEnv({ OFFICEXR_MODEL_SOURCES_BUCKET: 'b' })).rejects.toThrow('must be set together');
    await expect(modelSourceStoreFromEnv({ OFFICEXR_MODEL_SOURCES_SIGNER_EMAIL: 's@x' })).rejects.toThrow('must be set together');
  });
});
