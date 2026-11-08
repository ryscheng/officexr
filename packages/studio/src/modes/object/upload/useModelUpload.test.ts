import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorldObjectKind } from '@officexr/world';
import { StudioBusyError, type ModelSourcesClient, type UploadTarget } from './modelSourcesClient.ts';
import { toPackFiles, useModelUpload, type PackFile } from './useModelUpload.ts';

// jsdom's File has no arrayBuffer().
const packFile = (path: string): PackFile => {
  const file = new File(['x'], path.split('/').pop()!);
  file.arrayBuffer = async () => new TextEncoder().encode('x').buffer as ArrayBuffer;
  return { path, file };
};
const kindOf = (id: string) => ({ id }) as WorldObjectKind;

function fakeClient(overrides: Partial<ModelSourcesClient> = {}) {
  const batches: string[][] = [];
  const client: ModelSourcesClient = {
    async requestUploadUrls(_pack, files) {
      batches.push(files.map((f) => f.path));
      return files.map((f): UploadTarget => ({ path: f.path, url: `u/${f.path}`, method: 'PUT', headers: {} }));
    },
    put: async () => {},
    finalize: async (_pack, entry) => kindOf(entry),
    ...overrides,
  };
  return { client, batches };
}

async function run(client: ModelSourcesClient, files: PackFile[], sleep: (ms: number) => Promise<void> = async () => {}) {
  const onFinalized = vi.fn();
  const hook = renderHook(() => useModelUpload({ client, onFinalized, sleep }));
  await act(() => hook.result.current.start('pack', files));
  return { hook, onFinalized };
}

const states = (hook: ReturnType<typeof renderHook<ReturnType<typeof useModelUpload>, unknown>>) =>
  Object.fromEntries(hook.result.current.files.map((f) => [f.path, f.state]));

describe('useModelUpload', () => {
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
        if (target.path === 'flaky.png' && calls[target.path] === 1) {
          throw new Error('boom');
        }
        if (target.path === 'bad.png') {
          throw new Error('nope');
        }
      },
    });
    const { hook } = await run(client, [packFile('flaky.png'), packFile('bad.png')]);
    expect(calls).toEqual({ 'flaky.png': 2, 'bad.png': 2 });
    expect(states(hook)['flaky.png']).toEqual({ type: 'uploaded' });
    expect(states(hook)['bad.png']).toEqual({ type: 'failed', error: 'nope' });
  });

  it('finalizes only uploaded .glb/.gltf entries, one at a time', async () => {
    const finalize = vi.fn(async (_p: string, entry: string) => kindOf(entry));
    const { client } = fakeClient({
      finalize,
      put: async (target) => {
        if (target.path === 'broken.glb') {
          throw new Error('x');
        }
      },
    });
    const { onFinalized } = await run(client, ['a.glb', 'b.gltf', 'b.bin', 'tex.png', 'broken.glb'].map(packFile));
    expect(finalize.mock.calls.map((c) => c[1]).sort()).toEqual(['a.glb', 'b.gltf']);
    expect(onFinalized).toHaveBeenCalledTimes(1);
    expect(onFinalized.mock.calls[0][0].map((k: WorldObjectKind) => k.id).sort()).toEqual(['a.glb', 'b.gltf']);
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
    const { hook } = await run(client, [packFile('a.glb')], sleep);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
    expect(states(hook)['a.glb']).toEqual({ type: 'done', kindId: 'a.glb' });
  });

  it('gives up on a persistent 409 and reports a finalize error as failed', async () => {
    const { client } = fakeClient({
      finalize: async (_p, entry) => {
        throw entry === 'a.glb' ? new StudioBusyError() : new Error('bad model');
      },
    });
    const { hook, onFinalized } = await run(client, [packFile('a.glb'), packFile('b.glb')]);
    expect(states(hook)['a.glb'].type).toBe('failed');
    expect(states(hook)['b.glb']).toEqual({ type: 'failed', error: 'bad model' });
    expect(onFinalized).not.toHaveBeenCalled();
  });
});

describe('toPackFiles', () => {
  it('filters extensions and strips the picked folder name', () => {
    const f = (rel: string) => {
      const file = new File(['x'], rel.split('/').pop()!);
      Object.defineProperty(file, 'webkitRelativePath', { value: rel });
      return file;
    };
    const out = toPackFiles([f('pack/a.GLB'), f('pack/tex/b.png'), f('pack/readme.txt')]);
    expect(out.map((p) => p.path)).toEqual(['a.GLB', 'tex/b.png']);
  });
});
