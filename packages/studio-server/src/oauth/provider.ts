import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { sessionIdentity } from '@officexr/server';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { IsAllowed } from '../studio-gate.ts';
import { sendConsentPage, sendError } from './consent.ts';
import { newOpaqueToken, type Grant, type OAuthStore } from './store.ts';
import { TakeOnce } from './take-once.ts';

const MINUTE_MS = 60_000;
const CODE_TTL_MS = 10 * MINUTE_MS;
const CONSENT_TTL_MS = 10 * MINUTE_MS;
const ACCESS_TTL_MS = 60 * MINUTE_MS;
const REFRESH_TTL_MS = 30 * 24 * 60 * MINUTE_MS;

type PendingConsent = { clientId: string; login: string; params: AuthorizationParams };

/** Issues tokens only to logins `isAdmin` accepts, and only after the admin approves the consent page. */
export class AdminOAuthProvider implements OAuthServerProvider {
  // PKCE is checked in `exchangeAuthorizationCode`, against the code it consumes: the store can't read a code without spending it.
  readonly skipLocalPkceValidation = true;
  readonly clientsStore: OAuthRegisteredClientsStore;
  // ponytail: pending consents live in memory, so a restart drops them and the server must run as one replica.
  private readonly consents: TakeOnce<PendingConsent>;

  constructor(
    private readonly store: OAuthStore,
    private readonly isAdmin: IsAllowed,
    /** The web backend's `/auth/google` URL. */
    private readonly signInUrl: URL,
    /** The only RFC 8707 `resource` tokens are issued for. */
    private readonly resource: URL,
    private readonly now = () => new Date(),
  ) {
    this.clientsStore = {
      getClient: async (clientId) => (await store.getClient(clientId)) ?? undefined,
      registerClient: async (client) => {
        // The SDK's registration handler always generates the client_id before calling this.
        await store.registerClient(client as OAuthClientInformationFull);
        return client as OAuthClientInformationFull;
      },
    };
    this.consents = new TakeOnce(CONSENT_TTL_MS, now);
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    if (params.resource?.href !== this.resource.href) {
      throw new InvalidTargetError(`resource must be ${this.resource.href}`);
    }
    const req = res.req;
    const identity = sessionIdentity(req);
    if (!identity && req.method !== 'GET') {
      sendError(res, 401, 'Sign in to OfficeXR, then start again from your MCP client.');
      return;
    }
    if (!identity) {
      const signIn = new URL(this.signInUrl);
      signIn.searchParams.set('next', new URL(req.originalUrl, this.resource).href);
      res.redirect(302, signIn.href);
      return;
    }
    if (!(await this.isAdmin(identity.login))) {
      sendError(res, 403, `${identity.login} is not allowed to authorize MCP clients.`);
      return;
    }
    const csrfToken = newOpaqueToken();
    this.consents.put(csrfToken, { clientId: client.client_id, login: identity.login, params });
    sendConsentPage(res, client, params.redirectUri, csrfToken);
  }

  /** Issues a code for the consent `csrfToken` names, if `login` is the admin it was shown to; returns where to redirect. */
  async approve(csrfToken: string, login: string): Promise<string | null> {
    const consent = this.consents.take(csrfToken);
    if (!consent || consent.login !== login || !(await this.isAdmin(login))) {
      return null;
    }
    const { params } = consent;
    const code = newOpaqueToken();
    await this.store.saveCode(code, {
      clientId: consent.clientId,
      login,
      scopes: params.scopes ?? [],
      resource: params.resource?.href,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      expiresAt: this.after(CODE_TTL_MS),
    });
    const redirect = new URL(params.redirectUri);
    redirect.searchParams.set('code', code);
    if (params.state !== undefined) {
      redirect.searchParams.set('state', params.state);
    }
    return redirect.href;
  }

  async challengeForAuthorizationCode(): Promise<string> {
    throw new Error('unused: skipLocalPkceValidation is set');
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ) {
    const grant = await this.store.consumeCode(code);
    if (!grant || grant.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    if (codeVerifier === undefined || createHash('sha256').update(codeVerifier).digest('base64url') !== grant.codeChallenge) {
      throw new InvalidGrantError('code_verifier does not match the challenge');
    }
    if (redirectUri !== undefined && redirectUri !== grant.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }
    if (resource !== undefined && resource.href !== grant.resource) {
      throw new InvalidTargetError('resource does not match the authorization request');
    }
    if (!(await this.isAdmin(grant.login))) {
      throw new InvalidGrantError('Not an admin');
    }
    return this.issueTokens(grant);
  }

  async exchangeRefreshToken(client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL) {
    const grant = await this.store.findToken(refreshToken);
    if (grant?.kind !== 'refresh' || grant.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid refresh token');
    }
    if (scopes && !scopes.every((scope) => grant.scopes.includes(scope))) {
      throw new InvalidScopeError('Scopes exceed the original grant');
    }
    if (resource !== undefined && resource.href !== grant.resource) {
      throw new InvalidTargetError('resource does not match the original grant');
    }
    if (!(await this.isAdmin(grant.login))) {
      await this.store.revokeRefreshToken(refreshToken);
      throw new InvalidGrantError('Not an admin');
    }
    // Only the request that actually revokes the token may rotate it, so two concurrent refreshes can't both succeed.
    if (!(await this.store.revokeRefreshToken(refreshToken))) {
      throw new InvalidGrantError('Invalid refresh token');
    }
    return this.issueTokens({ ...grant, scopes: scopes ?? grant.scopes });
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const grant = await this.store.findToken(token);
    if (grant?.kind !== 'access') {
      throw new InvalidTokenError('Invalid access token');
    }
    if (!(await this.isAdmin(grant.login))) {
      throw new InvalidTokenError('Not an admin');
    }
    return {
      token,
      clientId: grant.clientId,
      scopes: grant.scopes,
      expiresAt: Math.floor(grant.expiresAt.getTime() / 1000),
      ...(grant.resource === undefined ? {} : { resource: new URL(grant.resource) }),
      extra: { login: grant.login },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, { token }: OAuthTokenRevocationRequest) {
    if ((await this.store.findToken(token))?.clientId === client.client_id) {
      await this.store.revokeToken(token);
    }
  }

  private async issueTokens({ clientId, login, scopes, resource }: Omit<Grant, 'expiresAt'>): Promise<OAuthTokens> {
    const grant = { clientId, login, scopes, resource };
    const accessToken = newOpaqueToken();
    const refreshToken = newOpaqueToken();
    await this.store.saveToken(accessToken, 'access', { ...grant, expiresAt: this.after(ACCESS_TTL_MS) });
    await this.store.saveToken(refreshToken, 'refresh', { ...grant, expiresAt: this.after(REFRESH_TTL_MS) });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_MS / 1000,
      refresh_token: refreshToken,
      ...(scopes.length ? { scope: scopes.join(' ') } : {}),
    };
  }

  private after(ms: number) {
    return new Date(this.now().getTime() + ms);
  }
}
