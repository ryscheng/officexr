import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackend, type Backend } from './backend';

const ENV = {
  // Never connected to: the pool is lazy and these specs make no query.
  SUPABASE_DB_URL: 'postgresql://unused@127.0.0.1:1/none',
  GOOGLE_CLIENT_ID: 'client-id',
  GOOGLE_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: 'session-secret',
  PUBLIC_URL: 'http://officexr.test',
};

let backend: Backend | undefined;
let server: Server | undefined;
afterEach(async () => {
  server?.close();
  await backend?.closePool();
});

describe('createBackend', () => {
  it('without dev options, refuses to start without Google sign-in', async () => {
    await expect(createBackend({ ...ENV, SESSION_SECRET: '' })).rejects.toThrow(/SESSION_SECRET$/);
  });

  it('without dev options, never signs requests in as OFFICEXR_DEV_USER_LOGIN', async () => {
    backend = await createBackend({ ...ENV, OFFICEXR_DEV_USER_LOGIN: 'dev@example.com' });
    server = createServer(backend.app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me`);
    expect(res.status).toBe(401);
  });

  it('with a dev user, signs every request in as that user without Google sign-in', async () => {
    backend = await createBackend({}, { dev: { user: { login: 'dev@example.com', name: 'Dev' } } });
    server = createServer(backend.app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/me`);
    expect(await res.json()).toEqual({ login: 'dev@example.com', name: 'Dev' });
  });
});
