import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyJoinToken } from '../join-token.ts';
import { createOfficeApi } from '../office-api.ts';

const SECRET = 's3cret';
let server: Server | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise((resolve) => server?.close(resolve));
});

async function stub(handler: (req: IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const officeJson = (office: unknown, status = 200) => stub((_req, res) => res.writeHead(status).end(JSON.stringify(office)));

describe('createOfficeApi allowsMultiSession', () => {
  it('allows only the creator of a debug-enabled office', async () => {
    const api = createOfficeApi({ baseUrl: await officeJson({ debug_enabled: true, created_by_login: 'ann' }) });
    expect(await api.allowsMultiSession('o1', 'ann')).toBe(true);
    expect(await api.allowsMultiSession('o1', 'bob')).toBe(false);
  });

  it('refuses a non-debug office', async () => {
    const api = createOfficeApi({ baseUrl: await officeJson({ debug_enabled: false, created_by_login: 'ann' }) });
    expect(await api.allowsMultiSession('o1', 'ann')).toBe(false);
  });

  it('refuses on a non-200 response', async () => {
    const api = createOfficeApi({ baseUrl: await officeJson({ debug_enabled: true, created_by_login: 'ann' }, 404) });
    expect(await api.allowsMultiSession('o1', 'ann')).toBe(false);
  });

  it('refuses when the server never answers', async () => {
    const api = createOfficeApi({ baseUrl: await stub(() => {}) });
    expect(await api.allowsMultiSession('o1', 'ann')).toBe(false);
  }, 10_000);

  it('requests the encoded office path with a fresh bearer token for the login', async () => {
    const seen: { url?: string; authorization?: string } = {};
    const baseUrl = await stub((req, res) => {
      seen.url = req.url;
      seen.authorization = req.headers.authorization;
      res.writeHead(200).end('{}');
    });
    await createOfficeApi({ baseUrl, tokenSecret: SECRET }).allowsMultiSession('a/b?', 'ann');

    expect(seen.url).toBe('/api/offices/a%2Fb%3F');
    expect(verifyJoinToken(SECRET, seen.authorization!.replace('Bearer ', ''), Date.now(), 'api')).toEqual({ login: 'ann' });
  });

  it('mints a short-lived api token from the injected clock', async () => {
    let authorization = '';
    const baseUrl = await stub((req, res) => {
      authorization = req.headers.authorization!;
      res.writeHead(200).end('{}');
    });
    await createOfficeApi({ baseUrl, tokenSecret: SECRET, now: () => 1_000_000 }).allowsMultiSession('o1', 'ann');
    const token = authorization.replace('Bearer ', '');

    expect(verifyJoinToken(SECRET, token, 1_000_000, 'api')).toEqual({ login: 'ann' });
    expect(verifyJoinToken(SECRET, token, 1_000_000 + 60_000, 'api')).toBeNull();
    expect(verifyJoinToken(SECRET, token, 1_000_000)).toBeNull();
  });

  it('sends no authorization without a token secret', async () => {
    let authorization: string | undefined = 'unset';
    const baseUrl = await stub((req, res) => {
      authorization = req.headers.authorization;
      res.writeHead(200).end('{}');
    });
    await createOfficeApi({ baseUrl }).allowsMultiSession('o1', 'ann');
    expect(authorization).toBeUndefined();
  });
});
