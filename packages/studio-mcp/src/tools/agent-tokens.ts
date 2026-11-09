import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { AgentTokens } from '../agent-tokens.ts';
import { errorResult, guard, jsonResult } from './shared.ts';

/** Runs `work` for the OAuth-authenticated user; the internal port has no `authInfo`, so the tools refuse there. */
function asAuthenticatedUser(
  authInfo: AuthInfo | undefined,
  work: (login: string, clientId: string) => Promise<unknown>,
): Promise<CallToolResult> {
  return guard(async () => {
    const login = authInfo?.extra?.login;
    if (!authInfo || typeof login !== 'string' || !login) {
      return errorResult('this tool works only on the authenticated public /mcp endpoint');
    }
    return jsonResult(await work(login, authInfo.clientId));
  });
}

export function registerAgentTokenTools(server: McpServer, agentTokens: AgentTokens): void {
  server.registerTool(
    'request_api_token',
    {
      description:
        'Ask for a 60-minute studio REST API token on behalf of the signed-in user. Returns {requestId, approvalUrl, expiresAt}: ' +
        'give the user the approvalUrl to open and approve; the request expires in 10 minutes. Then call get_api_token with the requestId.',
      inputSchema: {
        purpose: z.string().min(1).max(200).describe('Why you need the token, 1-200 characters; shown to the user approving it.'),
      },
    },
    (args, extra) => asAuthenticatedUser(extra.authInfo, (login, clientId) => agentTokens.request(login, { purpose: args.purpose, clientId })),
  );
  server.registerTool(
    'get_api_token',
    {
      description:
        'Collect the token for a request_api_token requestId. Returns {status}: while "pending", poll every few seconds, because once approved ' +
        'the token must be collected within 60 seconds. "approved" returns {token, expiresAt, apiBaseUrl} exactly once, so store it; it is valid ' +
        'for 60 minutes as "Authorization: Bearer <token>" on <apiBaseUrl>/api/*. "denied", "expired" or "claimed" mean start a new request with request_api_token.',
      inputSchema: { requestId: z.string().min(1).max(64).describe('The requestId returned by request_api_token.') },
    },
    (args, extra) => asAuthenticatedUser(extra.authInfo, (login, clientId) => agentTokens.poll(login, clientId, args.requestId)),
  );
}
