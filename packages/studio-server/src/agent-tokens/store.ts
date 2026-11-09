import type pg from 'pg';

export type AgentTokenRequestStatus = 'pending' | 'approved' | 'denied' | 'claimed';

export type AgentTokenRequest = {
  id: string;
  login: string;
  clientId: string;
  purpose: string;
  status: AgentTokenRequestStatus;
  createdAt: Date;
  /** Pending deadline. */
  expiresAt: Date;
  decidedAt: Date | null;
  claimedAt: Date | null;
};

export type NewAgentTokenRequest = Pick<AgentTokenRequest, 'id' | 'login' | 'clientId' | 'purpose' | 'expiresAt'>;

/** How long an approved request can be collected. */
export const CLAIM_WINDOW_MS = 60_000;

/**
 * Persistence for agent token requests. `decide` and `claim` are atomic conditional updates that return true only
 * for the one caller that moved the request; logins are lowercase.
 */
export interface AgentTokenRequestStore {
  create(request: NewAgentTokenRequest): Promise<void>;
  get(id: string): Promise<AgentTokenRequest | null>;
  /** Pending requests that haven't expired. */
  listPending(login: string): Promise<AgentTokenRequest[]>;
  /** Only while pending, unexpired and owned by `login`. */
  decide(id: string, login: string, outcome: 'approved' | 'denied'): Promise<boolean>;
  /** Approved to claimed, once, for `login` and `clientId` only, within `CLAIM_WINDOW_MS` of the decision. */
  claim(id: string, login: string, clientId: string): Promise<boolean>;
}

type Row = {
  id: string;
  login: string;
  client_id: string;
  purpose: string;
  status: AgentTokenRequestStatus;
  created_at: Date;
  expires_at: Date;
  decided_at: Date | null;
  claimed_at: Date | null;
};

const toRequest = (row: Row): AgentTokenRequest => ({
  id: row.id,
  login: row.login,
  clientId: row.client_id,
  purpose: row.purpose,
  status: row.status,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  decidedAt: row.decided_at,
  claimedAt: row.claimed_at,
});

// ponytail: expired and decided requests are never purged; add a periodic delete once the table grows.
export class PgAgentTokenRequestStore implements AgentTokenRequestStore {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async create(request: NewAgentTokenRequest) {
    await this.pool.query(
      'insert into agent_token_requests (id, login, client_id, purpose, expires_at) values ($1, $2, $3, $4, $5)',
      [request.id, request.login, request.clientId, request.purpose, request.expiresAt],
    );
  }

  async get(id: string) {
    const { rows } = await this.pool.query<Row>('select * from agent_token_requests where id = $1', [id]);
    return rows[0] ? toRequest(rows[0]) : null;
  }

  async listPending(login: string) {
    const { rows } = await this.pool.query<Row>(
      `select * from agent_token_requests
       where login = $1 and status = 'pending' and expires_at > now() order by created_at`,
      [login],
    );
    return rows.map(toRequest);
  }

  async decide(id: string, login: string, outcome: 'approved' | 'denied') {
    const { rowCount } = await this.pool.query(
      `update agent_token_requests set status = $3, decided_at = now()
       where id = $1 and login = $2 and status = 'pending' and expires_at > now()`,
      [id, login, outcome],
    );
    return rowCount === 1;
  }

  async claim(id: string, login: string, clientId: string) {
    const { rowCount } = await this.pool.query(
      `update agent_token_requests set status = 'claimed', claimed_at = now()
       where id = $1 and login = $2 and client_id = $3 and status = 'approved'
         and decided_at > now() - $4 * interval '1 millisecond'`,
      [id, login, clientId, CLAIM_WINDOW_MS],
    );
    return rowCount === 1;
  }
}

/** Same contract as `PgAgentTokenRequestStore`, for tests. */
export class InMemoryAgentTokenRequestStore implements AgentTokenRequestStore {
  private readonly requests = new Map<string, AgentTokenRequest>();
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  async create(request: NewAgentTokenRequest) {
    if (this.requests.has(request.id)) {
      throw new Error('duplicate request id');
    }
    this.requests.set(request.id, { ...request, status: 'pending', createdAt: this.now(), decidedAt: null, claimedAt: null });
  }

  async get(id: string) {
    const request = this.requests.get(id);
    return request ? { ...request } : null;
  }

  async listPending(login: string) {
    const now = this.now();
    return [...this.requests.values()]
      .filter((r) => r.login === login && r.status === 'pending' && r.expiresAt > now)
      .map((r) => ({ ...r }));
  }

  async decide(id: string, login: string, outcome: 'approved' | 'denied') {
    const now = this.now();
    const request = this.requests.get(id);
    if (!request || request.login !== login || request.status !== 'pending' || request.expiresAt <= now) {
      return false;
    }
    request.status = outcome;
    request.decidedAt = now;
    return true;
  }

  async claim(id: string, login: string, clientId: string) {
    const now = this.now();
    const request = this.requests.get(id);
    if (
      !request ||
      request.login !== login ||
      request.clientId !== clientId ||
      request.status !== 'approved' ||
      !request.decidedAt ||
      now.getTime() - request.decidedAt.getTime() >= CLAIM_WINDOW_MS
    ) {
      return false;
    }
    request.status = 'claimed';
    request.claimedAt = now;
    return true;
  }
}
