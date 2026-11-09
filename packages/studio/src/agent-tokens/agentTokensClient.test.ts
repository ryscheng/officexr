import { describe, expect, it, vi } from 'vitest';
import { createAgentTokensClient } from './agentTokensClient.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('createAgentTokensClient', () => {
  it('maps the pending list', async () => {
    const requests = [{ id: 'a', purpose: 'p', clientId: 'c', createdAt: '', expiresAt: '' }];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json(200, { requests }));
    expect(await createAgentTokensClient(fetchImpl).listPending()).toEqual(requests);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/agent-token-requests/');
  });

  it('posts JSON to the encoded decision route', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => json(200, { status: 'approved' }));
    const client = createAgentTokensClient(fetchImpl);
    await client.approve('a/b');
    await client.deny('a');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('/api/agent-token-requests/a%2Fb/approve');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/agent-token-requests/a/deny');
  });

  it('surfaces the error body, falling back to the status', async () => {
    await expect(createAgentTokensClient(async () => json(410, { error: 'expired' })).approve('a')).rejects.toThrow('expired');
    await expect(createAgentTokensClient(async () => new Response('x', { status: 500 })).listPending()).rejects.toThrow(
      'request failed (500)',
    );
  });
});
