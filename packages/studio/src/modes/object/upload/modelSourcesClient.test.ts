import { describe, expect, it, vi } from 'vitest';
import type { SignedUpload } from '@officexr/studio-mcp/model-sources';
import { createModelSourcesClient, StudioBusyError } from './modelSourcesClient.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('createModelSourcesClient', () => {
  it('maps a 409 to StudioBusyError', async () => {
    const client = createModelSourcesClient(async () => json(409, { error: 'busy' }));
    await expect(client.finalize('p', 'a.glb')).rejects.toBeInstanceOf(StudioBusyError);
  });

  it('surfaces the error body, falling back to the status', async () => {
    const withBody = createModelSourcesClient(async () => json(400, { error: 'bad pack' }));
    await expect(withBody.requestUploadUrls('p', [])).rejects.toThrow('bad pack');
    const noBody = createModelSourcesClient(async () => new Response('oops', { status: 500 }));
    await expect(noBody.finalize('p', 'a.glb')).rejects.toThrow('request failed (500)');
  });

  it('posts JSON for finalize', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json(200, { kind: { id: 'p/a' } }));
    const kind = await createModelSourcesClient(fetchImpl).finalize('p', 'a.glb');
    expect(kind).toEqual({ id: 'p/a' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/model-sources/finalize');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(init!.body as string)).toEqual({ pack: 'p', entry: 'a.glb' });
  });

  it('PUTs exactly the signed headers without credentials', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
    const target: SignedUpload = {
      path: 'a.glb',
      url: 'https://gcs.example/a',
      method: 'PUT',
      headers: { 'content-type': 'model/gltf-binary', 'x-goog-meta-sha256': 'ab' },
      expiresAt: '',
    };
    const body = new Blob(['x']);
    await createModelSourcesClient(fetchImpl).put(target, body);
    expect(fetchImpl).toHaveBeenCalledWith('https://gcs.example/a', {
      method: 'PUT',
      headers: target.headers,
      body,
      credentials: 'omit',
    });
  });

  it('recoverKind finds the finalized entry kind, or null when not finalized', async () => {
    const kind = { id: 'p/a', sourceObject: 'packs/p/a.glb' };
    const fetchFor = (finalizedEntries: string[]) =>
      createModelSourcesClient(async (url) =>
        String(url).startsWith('/api/model-sources')
          ? json(200, { packs: [{ pack: 'p', files: [], finalizedEntries }] })
          : json(200, { kinds: [kind] }),
      );
    expect(await fetchFor(['a.glb']).recoverKind('p', 'a.glb')).toEqual(kind);
    expect(await fetchFor([]).recoverKind('p', 'a.glb')).toBeNull();
  });
});
