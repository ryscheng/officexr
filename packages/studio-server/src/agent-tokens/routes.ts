import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextHandleFunction } from 'connect';
import { AgentTokenServiceError, type AgentTokenError, type AgentTokens } from '@officexr/studio-mcp/agent-tokens';
import type { createSessionReader } from '@officexr/server';
import { assertNever } from '../http.ts';
import { sendJson } from '../studio-gate.ts';

const statusOf = (error: AgentTokenError): number =>
  error.type === 'validation'
    ? 400
    : error.type === 'not_found'
      ? 404
      : error.type === 'not_pending'
        ? 409
        : error.type === 'expired'
          ? 410
          : assertNever(error);

const decision = /^\/([^/]+)\/(approve|deny)$/;

/**
 * Mount at `/api/agent-token-requests`, after the gate. Acts only for the session user: the identity comes from the
 * cookie or a preview token, never from a studio API token. With a `null` service every route answers 503.
 */
export function agentTokenRoutes(
  service: AgentTokens | null,
  sessionReader: ReturnType<typeof createSessionReader>,
): NextHandleFunction {
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = req.method === 'POST' ? decision.exec(url.pathname) : null;
    if (!match && !(req.method === 'GET' && url.pathname === '/')) {
      return false;
    }
    if (!service) {
      sendJson(res, 503, { error: 'Agent tokens are not configured' });
      return true;
    }
    const identity = sessionReader.sessionIdentity(req);
    if (!identity) {
      sendJson(res, 403, { error: 'A signed-in session is required' });
      return true;
    }
    // A cookie-authenticated POST must be a non-simple request: a cross-site form can't send application/json, and
    // only FRONTEND_ORIGINS pass the CORS preflight it forces.
    if (match && req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      sendJson(res, 415, { error: 'Content-Type must be application/json' });
      return true;
    }
    try {
      if (!match) {
        sendJson(res, 200, { requests: await service.listPending(identity.login) });
      } else if (match[2] === 'approve') {
        await service.approve(identity.login, decodeURIComponent(match[1]));
        sendJson(res, 200, { status: 'approved' });
      } else {
        await service.deny(identity.login, decodeURIComponent(match[1]));
        sendJson(res, 200, { status: 'denied' });
      }
    } catch (err) {
      if (err instanceof URIError) {
        sendJson(res, 404, { error: 'Request not found' });
      } else if (err instanceof AgentTokenServiceError) {
        sendJson(res, statusOf(err.error), { error: err.error.message });
      } else {
        throw err;
      }
    }
    return true;
  };
  return (req, res, next) => {
    handle(req, res).then((handled) => {
      if (!handled) {
        next();
      }
    }, next);
  };
}
