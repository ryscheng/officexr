export interface PendingTokenRequest {
  id: string;
  purpose: string;
  clientId: string;
  createdAt: string;
  expiresAt: string;
}

export interface TokenRequestResult {
  requestId: string;
  approvalUrl: string;
  expiresAt: string;
}

export type PollResult =
  | { status: 'pending'; expiresAt: string }
  | { status: 'denied' }
  | { status: 'expired' }
  | { status: 'claimed' }
  | { status: 'approved'; token: string; expiresAt: string; apiBaseUrl: string };

export type AgentTokenError =
  | { type: 'not_found'; message: string }
  | { type: 'not_pending'; message: string }
  | { type: 'expired'; message: string };

export class AgentTokenServiceError extends Error {
  readonly error: AgentTokenError;

  constructor(error: AgentTokenError) {
    super(error.message);
    this.error = error;
    this.name = 'AgentTokenServiceError';
  }
}

/** Short-lived studio API tokens an agent asks for and the same user approves. Failures throw `AgentTokenServiceError`. */
export interface AgentTokens {
  request(login: string, input: { purpose: string; clientId: string }): Promise<TokenRequestResult>;
  /** Hands the token out once; `not_found` for an unknown id or one owned by another login or client. */
  poll(login: string, clientId: string, requestId: string): Promise<PollResult>;
  listPending(login: string): Promise<PendingTokenRequest[]>;
  approve(login: string, requestId: string): Promise<void>;
  deny(login: string, requestId: string): Promise<void>;
}
