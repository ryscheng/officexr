import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Connect, PreviewServer, ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { officexrServer, type Office, type QueryOffices } from './api';

const ID = '11111111-1111-4111-8111-111111111111';
const offices: Office[] = [{ id: ID, name: 'HQ', description: null, map_name: 'hq' }];
const modelsDir = mkdtempSync(path.join(tmpdir(), 'officexr-models-'));
mkdirSync(path.join(modelsDir, 'characters'));
writeFileSync(path.join(modelsDir, 'characters', 'Mage.glb'), 'glb');
const outsideFile = path.join(modelsDir, '..', `${path.basename(modelsDir)}-secret.txt`);
writeFileSync(outsideFile, 'secret');
const outsideName = encodeURIComponent(path.basename(outsideFile));
const queryOffices: QueryOffices = async (id) => offices.filter((o) => !id || o.id === id);

/** Mimics connect's `use(base, fn)`: only matching paths reach `fn`, with `base` stripped from `req.url`. */
function mountAt(base: string, fn: Connect.NextHandleFunction): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = req.url ?? '';
    if (url !== base && !url.startsWith(`${base}/`) && !url.startsWith(`${base}?`)) {
      return next();
    }
    req.url = url.slice(base.length) || '/';
    fn(req, res, (err?: unknown) => {
      req.url = url;
      next(err);
    });
  };
}

let server: Server | undefined;
afterEach(() => server?.close());

type Hook = 'configureServer' | 'configurePreviewServer';

async function start(hook: Hook, devUser?: { login: string; name: string }): Promise<string> {
  const stack: Connect.NextHandleFunction[] = [];
  const fake = {
    middlewares: {
      use: (...args: [Connect.NextHandleFunction] | [string, Connect.NextHandleFunction]) => {
        const [base, fn] = args.length === 2 ? args : [undefined, args[0]];
        stack.push(base ? mountAt(base, fn) : fn);
      },
    },
  };
  for (const plugin of officexrServer({ queryOffices, devUser, modelsDir })) {
    (plugin[hook] as (s: ViteDevServer | PreviewServer) => void)(fake as unknown as ViteDevServer);
  }
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const run = (i: number): void => {
      if (i === stack.length) {
        res.statusCode = 404;
        res.end();
        return;
      }
      stack[i](req, res, () => run(i + 1));
    };
    run(0);
  });
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Sends `path` verbatim; `fetch` would normalise dot segments before the server sees them. */
function rawStatus(base: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    request(`${base}${path}`, { path }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    })
      .on('error', reject)
      .end();
  });
}

const tailscale = { 'Tailscale-User-Login': 'a@example.com', 'Tailscale-User-Name': 'Alice' };

describe('/api/me', () => {
  it('returns the Tailscale header identity', async () => {
    const base = await start('configurePreviewServer');
    const res = await fetch(`${base}/api/me`, { headers: tailscale });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'a@example.com', name: 'Alice' });
  });

  it('decodes RFC 2047 encoded names', async () => {
    const base = await start('configurePreviewServer');
    const res = await fetch(`${base}/api/me`, {
      headers: { 'Tailscale-User-Login': 'a@example.com', 'Tailscale-User-Name': '=?utf-8?q?Jos=C3=A9_Ruiz?=' },
    });
    expect((await res.json()).name).toBe('José Ruiz');
  });

  it('decodes base64 and split encoded words', async () => {
    const base = await start('configurePreviewServer');
    const res = await fetch(`${base}/api/me`, {
      headers: { 'Tailscale-User-Login': 'a@example.com', 'Tailscale-User-Name': '=?utf-8?b?Sm9z?= =?utf-8?q?=C3=A9?=' },
    });
    expect((await res.json()).name).toBe('José');
  });

  it('is 401 without headers', async () => {
    const base = await start('configurePreviewServer');
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });

  it('injects the dev user on the dev server', async () => {
    const base = await start('configureServer', { login: 'dev@example.com', name: 'Dev' });
    expect(await (await fetch(`${base}/api/me`)).json()).toEqual({ login: 'dev@example.com', name: 'Dev' });
  });

  it('ignores the dev user on the preview server', async () => {
    const base = await start('configurePreviewServer', { login: 'dev@example.com', name: 'Dev' });
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
  });
});

describe('/api/offices', () => {
  it('lists offices', async () => {
    const base = await start('configurePreviewServer');
    expect(await (await fetch(`${base}/api/offices`)).json()).toEqual(offices);
  });

  it('returns one office, or 404', async () => {
    const base = await start('configurePreviewServer');
    expect(await (await fetch(`${base}/api/offices/${ID}`)).json()).toEqual(offices[0]);
    expect((await fetch(`${base}/api/offices/22222222-2222-4222-8222-222222222222`)).status).toBe(404);
    expect((await fetch(`${base}/api/offices/not-a-uuid`)).status).toBe(404);
  });
});

describe('studio storage', () => {
  it('serves maps read-only', async () => {
    const base = await start('configurePreviewServer');
    expect((await fetch(`${base}/api/maps/default`)).status).toBe(200);
    for (const method of ['PUT', 'DELETE']) {
      expect((await fetch(`${base}/api/maps/default`, { method, body: method === 'PUT' ? '{}' : undefined })).status).toBe(405);
      expect((await fetch(`${base}/api/world-object-kinds`, { method })).status).toBe(405);
    }
  });
});

describe('/models', () => {
  it('serves model files and 404s outside the models dir', async () => {
    const base = await start('configurePreviewServer');
    const res = await fetch(`${base}/models/characters/Mage.glb`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('model/gltf-binary');
    expect(await res.text()).toBe('glb');
  });

  it('404s paths that escape the models dir', async () => {
    const base = await start('configurePreviewServer');
    expect(await rawStatus(base, `/models/..%2f${outsideName}`)).toBe(404);
    expect(await rawStatus(base, `/models/characters/..%2f..%2f${outsideName}`)).toBe(404);
  });

  it('400s malformed escapes and keeps serving', async () => {
    const base = await start('configurePreviewServer');
    expect(await rawStatus(base, '/models/%E0%A4%A')).toBe(400);
    expect((await fetch(`${base}/models/characters/Mage.glb`)).status).toBe(200);
  });
});
