import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_CONSTANTS } from '@officexr/sdk';
import { parsePushTargets, pushWorldConstants } from './push-world-constants.ts';

type Call = { url: string; init: RequestInit };

describe('pushWorldConstants', () => {
  it('sends the bearer token and doc to every target in parallel', async () => {
    const calls: Call[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      await gate;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const pending = pushWorldConstants({
      targets: ['http://a:8787/', 'http://b:8787'],
      token: 's3cret',
      doc: DEFAULT_WORLD_CONSTANTS,
      fetchFn,
    });
    // Both requests are in flight before either resolves.
    await Promise.resolve();
    expect(calls.map((c) => c.url)).toEqual([
      'http://a:8787/admin/world-constants',
      'http://b:8787/admin/world-constants',
    ]);
    release();
    expect(await pending).toEqual([]);
    for (const { init } of calls) {
      expect(init.method).toBe('PUT');
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer s3cret');
      expect(JSON.parse(init.body as string)).toEqual(DEFAULT_WORLD_CONSTANTS);
    }
  });

  it('reports non-204 replies, thrown errors and timeouts as failures', async () => {
    const fetchFn = (async (url: string, init: RequestInit) => {
      if (url.startsWith('http://bad-token')) {
        return new Response(null, { status: 401 });
      }
      if (url.startsWith('http://down')) {
        throw new Error('ECONNREFUSED');
      }
      if (url.startsWith('http://hang')) {
        return new Promise<Response>((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason)),
        );
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const failed = await pushWorldConstants({
      targets: ['http://ok', 'http://bad-token', 'http://down', 'http://hang'],
      token: 't',
      doc: DEFAULT_WORLD_CONSTANTS,
      fetchFn,
      timeoutMs: 20,
    });
    expect(failed).toEqual([
      { target: 'http://bad-token', status: 401 },
      { target: 'http://down', error: 'ECONNREFUSED' },
      { target: 'http://hang', error: expect.any(String) },
    ]);
  });

  it('is a no-op success with no targets', async () => {
    expect(
      await pushWorldConstants({ targets: [], token: undefined, doc: DEFAULT_WORLD_CONSTANTS }),
    ).toEqual([]);
  });
});

describe('parsePushTargets', () => {
  it('splits, trims and drops empties', () => {
    expect(parsePushTargets(' http://a , ,http://b')).toEqual(['http://a', 'http://b']);
    expect(parsePushTargets(undefined)).toEqual([]);
  });
});
