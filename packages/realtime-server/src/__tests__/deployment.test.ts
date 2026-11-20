import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { RealtimeServer, type DeploymentProvider } from '../server.ts';

describe('deployment endpoints', () => {
  const hosts: HttpServer[] = [];

  async function boot(deployment?: DeploymentProvider): Promise<string> {
    const server = new RealtimeServer({ deployment });
    const http = createServer((req, res) => {
      server.requestHandler(req, res, () => res.writeHead(404).end());
    });
    server.attach(http);
    await new Promise<void>((resolve) => http.listen(0, resolve));
    hosts.push(http);
    return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((h) => new Promise((resolve) => h.close(resolve))));
  });

  it('answers without a provider', async () => {
    const base = await boot();
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true, offices: ['debug-office'] });
    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: 'pass' });
    expect(await (await fetch(`${base}/version`)).json()).toEqual({});
  });

  it('adds the commit to /health and /version', async () => {
    const base = await boot({ commit: 'abc123' });
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true, commit: 'abc123', offices: ['debug-office'] });
    expect(await (await fetch(`${base}/version`)).json()).toEqual({ commit: 'abc123' });
  });

  it('maps readiness to 200 and 503', async () => {
    let result: { ok: true } | { ok: false; reason: string } = { ok: true };
    const base = await boot({ readiness: async () => result });
    expect((await fetch(`${base}/ready`)).status).toBe(200);
    result = { ok: false, reason: 'schema-behind' };
    const res = await fetch(`${base}/ready`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'fail', reason: 'schema-behind' });
  });

  it('keeps /health at 200 and never calls the providers', async () => {
    let calls = 0;
    const base = await boot({
      readiness: async () => {
        calls++;
        throw new Error('db down');
      },
      version: async () => {
        calls++;
        throw new Error('db down');
      },
    });
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect(calls).toBe(0);
    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(503);
    expect(await ready.json()).toEqual({ status: 'fail', reason: 'check-failed' });
    expect((await fetch(`${base}/version`)).status).toBe(200);
  });

  it('merges version fields', async () => {
    const base = await boot({ commit: 'c', version: async () => ({ builtAt: 'T' }) });
    expect(await (await fetch(`${base}/version`)).json()).toEqual({ commit: 'c', builtAt: 'T' });
  });
});
