import type { PendingTokenRequest } from '@officexr/studio-mcp/agent-tokens';
import { paths, studioApiUrl, studioFetch } from '../apiOrigin.ts';

export interface AgentTokensClient {
  listPending(): Promise<PendingTokenRequest[]>;
  approve(id: string): Promise<void>;
  deny(id: string): Promise<void>;
}

const base = paths.agentTokenRequests;

export function createAgentTokensClient(fetchImpl: typeof fetch = studioFetch): AgentTokensClient {
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchImpl(studioApiUrl(`${base}${path}`), init);
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) {
      throw new Error(json.error ?? `request failed (${res.status})`);
    }
    return json;
  }
  const decide = async (id: string, decision: 'approve' | 'deny') => {
    await request(`/${encodeURIComponent(id)}/${decision}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  };

  return {
    async listPending() {
      return (await request<{ requests: PendingTokenRequest[] }>('/')).requests;
    },
    approve: (id) => decide(id, 'approve'),
    deny: (id) => decide(id, 'deny'),
  };
}
