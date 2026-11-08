import { describe, expect, it, vi } from 'vitest';
import type { WorldObjectKind } from '@officexr/world';
import type { SignedUpload } from '@officexr/studio-mcp/model-sources';
import { StudioBusyError, type ModelSourcesClient } from './modelSourcesClient.ts';
import { runModelUpload, sha256Hex, toPackFiles, type FileState, type PackFile } from './runModelUpload.ts';

// jsdom's File has no arrayBuffer().
const packFile = (path: string, size = 1): PackFile => {
  const file = new File(['x'.repeat(size)], path.split('/').pop()!);
  file.arrayBuffer = async () => new TextEncoder().encode('x').buffer as ArrayBuffer;
  return { path, file };
};
const kindOf = (id: string) => ({ id }) as WorldObjectKind;

function fakeClient(overrides: Partial<ModelSourcesClient> = {}) {
  const batches: string[][] = [];
  const client: ModelSourcesClient = {
    async requestUploadUrls(_pack, files) {
      batches.push(files.map((f) => f.path));
      return files.map((f): SignedUpload => ({ path: f.path, url: `u/${f.path}`, method: 'PUT', headers: {}, expiresAt: '' }));
    },
    put: async () => {},
    finalize: async (_pack, entry) => kindOf(entry),
    recoverKind: async () => null,
    ...overrides,
  };
  return { client, batches };
}

async function run(client: ModelSourcesClient, files: PackFile[], sleep: (ms: number) => Promise<void> = async () => {}) {
  const states: Record<string, FileState> = {};
  const finalized: WorldObjectKind[] = [];
  await runModelUpload(client, 'pack', files, {
    sleep,
    onState: (path, state) => (states[path] = state),
    onFinalized: (kind) => finalized.push(kind),
  });
  return { states, finalized };
}

describe('runModelUpload', () => {
  it('requests upload URLs in batches of 50', async () => {
    const { client, batches } = fakeClient();
    await run(client, Array.from({ length: 120 }, (_, i) => packFile(`t${i}.png`)));
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
  });

  it('never runs more than 4 PUTs at once', async () => {
    let inFlight = 0;
    let max = 0;
    const { client } = fakeClient({
      async put() {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      },
    });
    await run(client, Array.from({ length: 12 }, (_, i) => packFile(`t${i}.png`)));
    expect(max).toBe(4);
  });

  it('retries a failed PUT once, then marks the file failed', async () => {
    const calls: Record<string, number> = {};
    const { client } = fakeClient({
      async put(target) {
        calls[target.path] = (calls[target.path] ?? 0) + 1;
        if (target.path === 'bad.png' || (target.path === 'flaky.png' && calls[target.path] === 1)) {
          throw new Error('nope');
        }
      },
    });
    const { states } = await run(client, [packFile('flaky.png'), packFile('bad.png')]);
    expect(calls).toEqual({ 'flaky.png': 2, 'bad.png': 2 });
    expect(states['flaky.png']).toEqual({ type: 'uploaded' });
    expect(states['bad.png']).toEqual({ type: 'failed', error: 'nope' });
  });

  it('finalizes only uploaded entries, in picked order, reporting each kind as it lands', async () => {
    const finalize = vi.fn(async (_p: string, entry: string) => kindOf(entry));
    const { client } = fakeClient({
      finalize,
      put: async (target) => {
        if (target.path === 'broken.glb') {
          throw new Error('x');
        }
      },
    });
    const { finalized } = await run(client, ['b.gltf', 'a.glb', 'a.bin', 'tex.png', 'broken.glb'].map((p) => packFile(p)));
    expect(finalize.mock.calls.map((c) => c[1])).toEqual(['b.gltf', 'a.glb']);
    expect(finalized.map((k) => k.id)).toEqual(['b.gltf', 'a.glb']);
  });

  it('skips a .gltf when a supporting file failed, but still finalizes a .glb', async () => {
    const { client } = fakeClient({
      put: async (target) => {
        if (target.path === 'scene.bin') {
          throw new Error('x');
        }
      },
    });
    const { states } = await run(client, ['scene.gltf', 'scene.bin', 'solo.glb'].map((p) => packFile(p)));
    expect(states['scene.gltf']).toEqual({ type: 'failed', error: 'skipped: scene.bin did not upload' });
    expect(states['solo.glb']).toEqual({ type: 'done', kindId: 'solo.glb' });
  });

  it('rejects an invalid file on its own without failing its batch', async () => {
    const { client, batches } = fakeClient();
    const { states } = await run(client, [packFile('A.GLB'), packFile('bad name.png'), packFile('../x.png'), packFile('ok.png')]);
    expect(batches).toEqual([['ok.png']]);
    for (const p of ['A.GLB', 'bad name.png', '../x.png']) {
      expect(states[p]).toMatchObject({ type: 'failed' });
      expect((states[p] as { error: string }).error).toMatch(/^rejected: /);
    }
    expect(states['ok.png']).toEqual({ type: 'uploaded' });
  });

  it('fails files the server returned no URL for', async () => {
    const { client } = fakeClient({ requestUploadUrls: async () => [] });
    const { states } = await run(client, [packFile('a.png')]);
    expect(states['a.png']).toEqual({ type: 'failed', error: 'no upload URL returned' });
  });

  it('backs off on 409 then succeeds', async () => {
    let attempts = 0;
    const { client } = fakeClient({
      async finalize(_p, entry) {
        if (++attempts < 3) {
          throw new StudioBusyError();
        }
        return kindOf(entry);
      },
    });
    const sleep = vi.fn(async (_ms: number) => {});
    const { states } = await run(client, [packFile('a.glb')], sleep);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    expect(states['a.glb']).toEqual({ type: 'done', kindId: 'a.glb' });
  });

  it('gives up on a persistent 409 and reports a finalize error as failed', async () => {
    const { client } = fakeClient({
      finalize: async (_p, entry) => {
        throw entry === 'a.glb' ? new StudioBusyError() : new Error('bad model');
      },
    });
    const { states, finalized } = await run(client, [packFile('a.glb'), packFile('b.glb')]);
    expect(states['a.glb'].type).toBe('failed');
    expect(states['b.glb']).toEqual({ type: 'failed', error: 'bad model' });
    expect(finalized).toEqual([]);
  });

  it('recovers the kind when finalize errored but the server finalized it', async () => {
    const { client } = fakeClient({
      finalize: async () => {
        throw new Error('network');
      },
      recoverKind: async (_p, entry) => kindOf(entry),
    });
    const { states, finalized } = await run(client, [packFile('a.glb')]);
    expect(states['a.glb']).toEqual({ type: 'done', kindId: 'a.glb' });
    expect(finalized.map((k) => k.id)).toEqual(['a.glb']);
  });
});

describe('toPackFiles', () => {
  it('drops other extensions, strips the folder name and keeps one file per path', () => {
    const f = (rel: string) => {
      const file = new File(['x'], rel.split('/').pop()!);
      Object.defineProperty(file, 'webkitRelativePath', { value: rel });
      return file;
    };
    const out = toPackFiles([f('pack/a.GLB'), f('pack/tex/b.png'), f('pack/readme.txt'), f('pack/tex/b.png')]);
    expect(out.map((p) => p.path)).toEqual(['a.GLB', 'tex/b.png']);
  });
});

describe('sha256Hex', () => {
  it('matches the known vector for "abc"', async () => {
    const blob = { arrayBuffer: async () => new TextEncoder().encode('abc').buffer } as Blob;
    expect(await sha256Hex(blob)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
