import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/** What a code or token vouches for. `resource` is the RFC 8707 audience, if one was requested. */
export type Grant = { clientId: string; login: string; scopes: string[]; resource?: string; expiresAt: Date };
export type CodeGrant = Grant & { codeChallenge: string; redirectUri: string };
export type TokenKind = 'access' | 'refresh';
export type StoredToken = Grant & { kind: TokenKind };

/**
 * Persistence for the MCP OAuth server. Callers pass and receive raw codes, tokens and secrets; only their
 * SHA-256 hashes are stored. A client's `client_secret` is never returned: check it with `verifyClientSecret`.
 */
export interface OAuthStore {
  getClient(clientId: string): Promise<OAuthClientInformationFull | null>;
  /** Throws if `client_id` is already registered. */
  registerClient(client: OAuthClientInformationFull): Promise<void>;
  verifyClientSecret(clientId: string, secret: string): Promise<boolean>;
  /** Throws if the client is unknown. */
  saveCode(code: string, grant: CodeGrant): Promise<void>;
  /** Returns the grant once; null if the code is unknown, already consumed or expired. */
  consumeCode(code: string): Promise<CodeGrant | null>;
  /** Throws if the client is unknown. */
  saveToken(token: string, kind: TokenKind, grant: Grant): Promise<void>;
  /** Null if the token is unknown, revoked or expired. */
  findToken(token: string): Promise<StoredToken | null>;
  revokeToken(token: string): Promise<void>;
  /** True only for the call that revokes a live refresh token, so a refresh token rotates at most once. */
  revokeRefreshToken(token: string): Promise<boolean>;
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function splitSecret({ client_secret, ...metadata }: OAuthClientInformationFull) {
  return { metadata, secretHash: client_secret === undefined ? null : sha256(client_secret) };
}

type GrantRow = { client_id: string; login: string; scopes: string[]; resource: string | null; expires_at: Date };

const toGrant = (row: GrantRow): Grant => ({
  clientId: row.client_id,
  login: row.login,
  scopes: row.scopes,
  ...(row.resource === null ? {} : { resource: row.resource }),
  expiresAt: row.expires_at,
});

export class PgOAuthStore implements OAuthStore {
  constructor(private readonly pool: pg.Pool) {}

  async getClient(clientId: string) {
    const { rows } = await this.pool.query<{ metadata: OAuthClientInformationFull }>(
      'select metadata from mcp_oauth_clients where client_id = $1',
      [clientId],
    );
    return rows[0]?.metadata ?? null;
  }

  async registerClient(client: OAuthClientInformationFull) {
    const { metadata, secretHash } = splitSecret(client);
    await this.pool.query('insert into mcp_oauth_clients (client_id, metadata, secret_hash) values ($1, $2, $3)', [
      client.client_id,
      metadata,
      secretHash,
    ]);
  }

  async verifyClientSecret(clientId: string, secret: string) {
    const { rows } = await this.pool.query<{ ok: boolean }>(
      'select secret_hash = $2 as ok from mcp_oauth_clients where client_id = $1 and secret_hash is not null',
      [clientId, sha256(secret)],
    );
    return rows[0]?.ok ?? false;
  }

  async saveCode(code: string, grant: CodeGrant) {
    await this.pool.query(
      `insert into mcp_oauth_codes (code_hash, client_id, login, code_challenge, redirect_uri, scopes, resource, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [sha256(code), grant.clientId, grant.login, grant.codeChallenge, grant.redirectUri, grant.scopes, grant.resource ?? null, grant.expiresAt],
    );
  }

  async consumeCode(code: string) {
    const { rows } = await this.pool.query<GrantRow & { code_challenge: string; redirect_uri: string }>(
      `update mcp_oauth_codes set consumed_at = now()
       where code_hash = $1 and consumed_at is null and expires_at > now()
       returning client_id, login, code_challenge, redirect_uri, scopes, resource, expires_at`,
      [sha256(code)],
    );
    const row = rows[0];
    return row && { ...toGrant(row), codeChallenge: row.code_challenge, redirectUri: row.redirect_uri };
  }

  async saveToken(token: string, kind: TokenKind, grant: Grant) {
    await this.pool.query(
      `insert into mcp_oauth_tokens (token_hash, kind, client_id, login, scopes, resource, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [sha256(token), kind, grant.clientId, grant.login, grant.scopes, grant.resource ?? null, grant.expiresAt],
    );
  }

  async findToken(token: string) {
    const { rows } = await this.pool.query<GrantRow & { kind: TokenKind }>(
      `select kind, client_id, login, scopes, resource, expires_at from mcp_oauth_tokens
       where token_hash = $1 and revoked_at is null and expires_at > now()`,
      [sha256(token)],
    );
    const row = rows[0];
    return row && { ...toGrant(row), kind: row.kind };
  }

  async revokeToken(token: string) {
    await this.pool.query('update mcp_oauth_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null', [sha256(token)]);
  }

  async revokeRefreshToken(token: string) {
    const { rowCount } = await this.pool.query(
      `update mcp_oauth_tokens set revoked_at = now()
       where token_hash = $1 and kind = 'refresh' and revoked_at is null and expires_at > now()`,
      [sha256(token)],
    );
    return rowCount === 1;
  }
}

/** Same contract as `PgOAuthStore`, for tests. */
export class InMemoryOAuthStore implements OAuthStore {
  private readonly clients = new Map<string, { client: OAuthClientInformationFull; secretHash: string | null }>();
  private readonly codes = new Map<string, { grant: CodeGrant; consumed: boolean }>();
  private readonly tokens = new Map<string, { token: StoredToken; revoked: boolean }>();

  constructor(private readonly now = () => new Date()) {}

  async getClient(clientId: string) {
    const entry = this.clients.get(clientId);
    return entry ? splitSecret(entry.client).metadata : null;
  }

  async registerClient(client: OAuthClientInformationFull) {
    if (this.clients.has(client.client_id)) {
      throw new Error(`client ${client.client_id} already registered`);
    }
    this.clients.set(client.client_id, { client, secretHash: splitSecret(client).secretHash });
  }

  async verifyClientSecret(clientId: string, secret: string) {
    const hash = this.clients.get(clientId)?.secretHash;
    return hash != null && hash === sha256(secret);
  }

  async saveCode(code: string, grant: CodeGrant) {
    this.requireClient(grant.clientId);
    this.codes.set(sha256(code), { grant, consumed: false });
  }

  async consumeCode(code: string) {
    const entry = this.codes.get(sha256(code));
    if (!entry || entry.consumed || entry.grant.expiresAt <= this.now()) {
      return null;
    }
    entry.consumed = true;
    return entry.grant;
  }

  async saveToken(token: string, kind: TokenKind, grant: Grant) {
    this.requireClient(grant.clientId);
    this.tokens.set(sha256(token), { token: { ...grant, kind }, revoked: false });
  }

  async findToken(token: string) {
    const entry = this.tokens.get(sha256(token));
    return entry && !entry.revoked && entry.token.expiresAt > this.now() ? entry.token : null;
  }

  async revokeToken(token: string) {
    const entry = this.tokens.get(sha256(token));
    if (entry) {
      entry.revoked = true;
    }
  }

  async revokeRefreshToken(token: string) {
    const entry = this.tokens.get(sha256(token));
    if (!entry || entry.token.kind !== 'refresh' || (await this.findToken(token)) === null) {
      return false;
    }
    entry.revoked = true;
    return true;
  }

  private requireClient(clientId: string) {
    if (!this.clients.has(clientId)) {
      throw new Error(`unknown client ${clientId}`);
    }
  }
}
