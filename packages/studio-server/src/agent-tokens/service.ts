import { randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import {
  AgentTokenServiceError,
  type AgentTokens,
  type PendingTokenRequest,
  type PollResult,
  type TokenRequestResult,
} from '@officexr/studio-mcp/agent-tokens';
import { CLAIM_WINDOW_MS, type AgentTokenRequest, type AgentTokenRequestStore } from './store.ts';

const PENDING_MS = 10 * 60_000;
const TOKEN_TTL_SECONDS = 3600;
const CLOCK_TOLERANCE_SECONDS = 5;
const MAX_PURPOSE_LENGTH = 200;

export class AgentTokenService implements AgentTokens {
  private readonly store: AgentTokenRequestStore;
  private readonly secret: Uint8Array;
  private readonly issuer: string;
  private readonly studioAppUrl: string;
  private readonly now: () => Date;

  constructor(opts: { store: AgentTokenRequestStore; secret: string; issuer: string; studioAppUrl: string; now?: () => Date }) {
    this.store = opts.store;
    this.secret = new TextEncoder().encode(opts.secret);
    this.issuer = opts.issuer;
    this.studioAppUrl = opts.studioAppUrl;
    this.now = opts.now ?? (() => new Date());
  }

  async request(login: string, input: { purpose: string; clientId: string }): Promise<TokenRequestResult> {
    const purpose = input.purpose.trim();
    if (purpose.length === 0 || purpose.length > MAX_PURPOSE_LENGTH) {
      throw new AgentTokenServiceError({ type: 'validation', message: `purpose must be 1-${MAX_PURPOSE_LENGTH} characters` });
    }
    const id = randomBytes(16).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + PENDING_MS);
    await this.store.create({
      id,
      login: login.toLowerCase(),
      clientId: input.clientId,
      purpose,
      expiresAt,
    });
    return { requestId: id, approvalUrl: `${this.studioAppUrl}/?agentTokenRequest=${id}`, expiresAt: expiresAt.toISOString() };
  }

  async poll(login: string, clientId: string, requestId: string): Promise<PollResult> {
    const request = await this.store.get(requestId);
    if (!request || request.login !== login.toLowerCase() || request.clientId !== clientId) {
      throw notFound();
    }
    const now = this.now();
    if (request.status === 'denied' || request.status === 'claimed') {
      return { status: request.status };
    }
    if (request.status === 'pending') {
      return request.expiresAt <= now ? { status: 'expired' } : { status: 'pending', expiresAt: request.expiresAt.toISOString() };
    }
    if (!request.decidedAt || now.getTime() - request.decidedAt.getTime() >= CLAIM_WINDOW_MS) {
      return { status: 'expired' };
    }
    if (!(await this.store.claim(requestId, request.login, clientId))) {
      const current = await this.store.get(requestId);
      return { status: current?.status === 'claimed' ? 'claimed' : 'expired' };
    }
    const { token, expiresAt } = await this.mint(request, now);
    return { status: 'approved', token, expiresAt: expiresAt.toISOString(), apiBaseUrl: this.issuer };
  }

  async listPending(login: string): Promise<PendingTokenRequest[]> {
    const requests = await this.store.listPending(login.toLowerCase());
    return requests.map((r) => ({
      id: r.id,
      purpose: r.purpose,
      clientId: r.clientId,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    }));
  }

  async approve(login: string, requestId: string) {
    await this.decide(login, requestId, 'approved');
  }

  async deny(login: string, requestId: string) {
    await this.decide(login, requestId, 'denied');
  }

  /** The token's login, or null unless it is an unexpired HS256 token from this issuer for `${issuer}/api`. */
  async verify(token: string): Promise<{ login: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: this.issuer,
        audience: `${this.issuer}/api`,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        currentDate: this.now(),
      });
      return payload.sub ? { login: payload.sub } : null;
    } catch {
      return null;
    }
  }

  private async decide(login: string, requestId: string, outcome: 'approved' | 'denied') {
    const owner = login.toLowerCase();
    if (await this.store.decide(requestId, owner, outcome)) {
      return;
    }
    const request = await this.store.get(requestId);
    if (!request || request.login !== owner) {
      throw notFound();
    }
    if (request.status === 'pending') {
      throw new AgentTokenServiceError({ type: 'expired', message: 'The token request has expired' });
    }
    throw new AgentTokenServiceError({ type: 'not_pending', message: 'The token request was already decided' });
  }

  private async mint(request: AgentTokenRequest, now: Date) {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + TOKEN_TTL_SECONDS;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(this.issuer)
      .setAudience(`${this.issuer}/api`)
      .setSubject(request.login)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setJti(request.id)
      .sign(this.secret);
    return { token, expiresAt: new Date(exp * 1000) };
  }
}

const notFound = () => new AgentTokenServiceError({ type: 'not_found', message: 'No such token request' });
