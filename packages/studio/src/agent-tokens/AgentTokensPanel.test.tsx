import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TestStorageProvider } from '../test-harness/TestStorageContext.tsx';
import type { AgentTokensClient } from './agentTokensClient.ts';
import { AgentTokensPanel } from './AgentTokensPanel.tsx';

const request = (id: string) => ({
  id,
  purpose: `purpose ${id}`,
  clientId: 'claude',
  createdAt: '',
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
});

function setup(initial: string[], highlightId: string | null = null) {
  let pending = initial.map(request);
  const calls: string[] = [];
  const client: AgentTokensClient = {
    listPending: async () => pending,
    approve: async (id) => {
      calls.push(`approve ${id}`);
      pending = pending.filter((r) => r.id !== id);
    },
    deny: async (id) => {
      calls.push(`deny ${id}`);
      pending = pending.filter((r) => r.id !== id);
    },
  };
  render(
    <TestStorageProvider value={{ agentTokensClient: client }}>
      <AgentTokensPanel highlightId={highlightId} onClose={() => {}} />
    </TestStorageProvider>,
  );
  return calls;
}

describe('AgentTokensPanel', () => {
  it('lists requests with time left and the grant warning', async () => {
    setup(['a']);
    expect(await screen.findByText('purpose a')).toBeTruthy();
    expect(screen.getByText(/claude · [45] min left/)).toBeTruthy();
    expect(screen.getByText('Gives this agent a 60-minute API token that acts as you.')).toBeTruthy();
  });

  it('approves and denies, refreshing and confirming', async () => {
    const calls = setup(['a', 'b']);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Approve' }))[0]);
    expect(await screen.findByText('Approved. Your agent can now collect its token.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('purpose a')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(screen.queryByText('purpose b')).toBeNull());
    expect(calls).toEqual(['approve a', 'deny b']);
  });

  it('highlights the linked request', async () => {
    setup(['a', 'b'], 'b');
    const items = await screen.findAllByTestId('agent-token-request');
    expect(items.map((i) => i.dataset.highlighted)).toEqual(['false', 'true']);
  });

  it('says so when the linked request is not listed', async () => {
    setup(['a'], 'gone');
    expect(await screen.findByText(/not found.*already be decided or have expired/)).toBeTruthy();
  });
});
