import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PendingTokenRequest } from '@officexr/studio-mcp/agent-tokens';
import { Button } from '../components/ui/button.tsx';
import { useTestStorages } from '../test-harness/TestStorageContext.tsx';
import { createAgentTokensClient } from './agentTokensClient.ts';

const minutesLeft = (expiresAt: string) => Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000));

/** The `?agentTokenRequest=<id>` an approval link carries, or `null`. */
export const linkedRequestId = () =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('agentTokenRequest');

interface AgentTokensPanelProps {
  /** Request to highlight, from the approval link. */
  highlightId: string | null;
  onClose: () => void;
}

export function AgentTokensPanel({ highlightId, onClose }: AgentTokensPanelProps) {
  const injected = useTestStorages()?.agentTokensClient;
  const client = useMemo(() => injected ?? createAgentTokensClient(), [injected]);
  const [requests, setRequests] = useState<PendingTokenRequest[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRequests(await client.listPending());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const decide = async (id: string, decision: 'approve' | 'deny') => {
    setError(null);
    setMessage(null);
    let failure: string | null = null;
    try {
      await client[decision](id);
      setMessage(decision === 'approve' ? 'Approved. Your agent has 60 seconds to collect its token.' : 'Denied.');
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    await refresh();
    if (failure) {
      setError(failure);
    }
  };

  const missing = highlightId && requests && !requests.some((r) => r.id === highlightId);

  return (
    <section
      role="region"
      aria-label="Agent tokens"
      className="fixed right-4 top-12 z-30 w-96 rounded-md border border-border bg-card p-3 text-xs text-card-foreground shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <strong>Agent tokens</strong>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {missing && (
        <p role="alert">That request was not found. It may already be decided or have expired.</p>
      )}
      {requests?.length === 0 && <p>No pending requests.</p>}
      <ul className="space-y-2">
        {requests?.map((r) => (
          <li
            key={r.id}
            data-testid="agent-token-request"
            data-highlighted={r.id === highlightId}
            className={`rounded-sm border p-2 ${r.id === highlightId ? 'border-primary' : 'border-border'}`}
          >
            <div>{r.purpose}</div>
            <div className="text-muted-foreground">
              {r.clientId} · {minutesLeft(r.expiresAt)} min left
            </div>
            <p className="my-1">Gives this agent a 60-minute API token that acts as you.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void decide(r.id, 'approve')}>
                Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void decide(r.id, 'deny')}>
                Deny
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
