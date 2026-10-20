import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connect, PreviewServer, ViteDevServer } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { officexrServer, type Office, type QueryOffices } from './api';

const ID = '11111111-1111-4111-8111-111111111111';
const offices: Office[] = [{ id: ID, name: 'HQ', description: null }];
const queryOffices: QueryOffices = async (id) => offices.filter((o) => !id || o.id === id);

let server: Server | undefined;
afterEach(() => server?.close());

type Hook = 'configureServer' | 'configurePreviewServer';

async function start(hook: Hook, devUser?: { login: string; name: string }): Promise<string> {
  const stack: Connect.NextHandleFunction[] = [];
  const fake = { middlewares: { use: (fn: Connect.NextHandleFunction) => stack.push(fn) } };
  const plugin = officexrServer({ queryOffices, devUser });
  (plugin[hook] as (s: ViteDevServer | PreviewServer) => void)(fake as unknown as ViteDevServer);
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

const tailscale = { 'Tailscale-User-Login': 'a@example.com', 'Tailscale-User-Name': 'Alice' };

describe('/api/me', () => {
  it('returns the Tailscale header identity', async () => {
    const base = await start('configurePreviewServer');
    const res = await fetch(`${base}/api/me`, { headers: tailscale });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ login: 'a@example.com', name: 'Alice' });
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
