import type { IncomingMessage, ServerResponse } from 'node:http';
import type { NextHandleFunction } from 'connect';
import { INTEGRATION_NOTICE_KIND, type DeskClaimant } from '@officexr/sdk';
import type { OfficeDeskClaims, QueryOffices, ResolveIdentity } from './api';
import type { CalendarService } from './calendarService';
import { createCooldown } from './cooldown';
import { consentUrl, signOAuthState, verifyOAuthState, type GoogleCalendarConfig } from './googleCalendar';
import { BE_THERE_ACTION, parsePingReply, pingMessage, SIGNATURE_WINDOW_SECONDS, verifySlackSignature, type SlackClient, type SlackDirectory } from './slack';
import { safeReturnTarget } from './auth';
import type { Identity, Office } from './shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_JSON_BYTES = 1024;
const MAX_SLACK_BODY_BYTES = 64 * 1024;
const CLAIMANT_DECORATION_TIMEOUT_MS = 3_000;
export const SLACK_PING_COOLDOWN_MS = 2 * 60_000;

export interface CalendarIntegration {
  service: CalendarService;
  config: GoogleCalendarConfig;
}

export interface SlackIntegration {
  signingSecret: string;
  client: SlackClient;
  directory: SlackDirectory;
}

export interface OfficePresence {
  hasLiveSession: (officeId: string, login: string) => boolean;
  notifyLogin: (officeId: string, login: string, kind: string, payload: unknown) => boolean;
}

export interface IntegrationsOptions {
  identity: ResolveIdentity;
  queryOffices: QueryOffices;
  deskClaims: Pick<OfficeDeskClaims, 'claimants'>;
  presence: OfficePresence;
  publicUrl: string;
  sessionSecret: string;
  frontendOrigins: string[];
  calendar?: CalendarIntegration;
  slack?: SlackIntegration;
  fetch?: typeof fetch;
  now?: () => number;
}

export function claimantDecorator({ calendar, slack }: Pick<IntegrationsOptions, 'calendar' | 'slack'>) {
  if (!calendar && !slack) {
    return undefined;
  }
  return async (claimants: Record<string, DeskClaimant>): Promise<Record<string, DeskClaimant>> => {
    const logins = Object.keys(claimants);
    const decorate = async () => {
      const calendars = (await calendar?.service.statuses(logins)) ?? {};
      const needSlack = logins.filter((login) => !Object.hasOwn(calendars, login));
      const slackStatuses = needSlack.length ? ((await slack?.directory.statuses(needSlack)) ?? {}) : {};
      return Object.fromEntries(
        logins.map((login) => [login, { ...claimants[login], ...(Object.hasOwn(calendars, login) ? { calendar: calendars[login] } : {}), ...(!Object.hasOwn(calendars, login) && Object.hasOwn(slackStatuses, login) ? { slack: slackStatuses[login] } : {}) }]),
      );
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(resolve, CLAIMANT_DECORATION_TIMEOUT_MS, undefined);
    });
    try {
      return (await Promise.race([decorate().catch(() => undefined), timeout])) ?? claimants;
    } finally {
      clearTimeout(timer);
    }
  };
}

class BodyTooLarge extends Error {}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      throw new BodyTooLarge();
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const withParam = (target: string, name: string, value: string) => {
  const [base, hash] = target.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}${name}=${value}${hash === undefined ? '' : `#${hash}`}`;
};

const header = (req: IncomingMessage, name: string) => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

 // SRP violation: one middleware owns both integrations' routes because they share the request plumbing (identity, body reads, redirects).
 // Split into a shared route-helper module when a third integration lands.
export function integrationsMiddleware(options: IntegrationsOptions): NextHandleFunction {
  const { identity, queryOffices, deskClaims, presence, publicUrl, sessionSecret, frontendOrigins, calendar, slack, fetch: fetchFn = fetch, now = Date.now } = options;
  const pingCooldown = createCooldown(SLACK_PING_COOLDOWN_MS, now);
  // A signed request stays valid for the signature window, so a replay must be dropped by its timestamp and signature.
  const seenInteractions = createCooldown((SIGNATURE_WINDOW_SECONDS + 60) * 1000, now);
  const officeUrl = (officeId: string) => new URL(`/room/${officeId}`, publicUrl).href;

  return async (req, res, next) => {
    const path = req.url?.split('?')[0] ?? '';
    const query = new URLSearchParams(req.url?.split('?')[1] ?? '');
    const send = (status: number, body?: unknown) => {
      res.statusCode = status;
      if (body === undefined) {
        return res.end();
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const redirect = (location: string) => {
      res.statusCode = 302;
      res.setHeader('Location', location);
      res.end();
    };
    const slackPingOffice = path.match(/^\/api\/offices\/([^/]+)\/slack-ping$/)?.[1];
    const isMine =
      path === '/api/integrations' ||
      path === '/api/calendar' ||
      path === '/auth/google/calendar' ||
      path === '/auth/google/calendar/callback' ||
      path === '/api/slack/interactions' ||
      slackPingOffice !== undefined;
    if (!isMine) {
      return next();
    }
    try {
      if (path === '/api/slack/interactions') {
        return await handleInteraction(req, res);
      }
      const me = await identity(req);
      if (path === '/api/integrations') {
        if (req.method !== 'GET') {
          return send(405, { error: 'Method not allowed' });
        }
        if (!me) {
          return send(401, { error: 'Not signed in' });
        }
        return send(200, {
          calendar: { enabled: !!calendar, connected: calendar ? await calendar.service.isConnected(me.login) : false },
          slack: { enabled: !!slack },
        });
      }
      if (path === '/api/calendar') {
        if (!calendar) {
          return send(404, { error: 'Calendar is not enabled' });
        }
        if (req.method !== 'DELETE') {
          return send(405, { error: 'Method not allowed' });
        }
        if (!me) {
          return send(401, { error: 'Not signed in' });
        }
        await calendar.service.disconnect(me.login);
        return send(204);
      }
      if (path === '/auth/google/calendar' || path === '/auth/google/calendar/callback') {
        if (!calendar) {
          return send(404, { error: 'Calendar is not enabled' });
        }
        if (req.method !== 'GET') {
          return send(405, { error: 'Method not allowed' });
        }
        if (!me) {
          return send(401, { error: 'Not signed in' });
        }
        if (path === '/auth/google/calendar') {
          const returnTo = safeReturnTarget(query.get('next'), frontendOrigins);
          const state = signOAuthState(sessionSecret, { login: me.login, returnTo }, now());
          return redirect(consentUrl({ config: calendar.config, state, loginHint: me.login }));
        }
        const state = verifyOAuthState(sessionSecret, query.get('state') ?? '', now());
        if (!state || state.login !== me.login) {
          return send(400, { error: 'Invalid or expired state' });
        }
        const code = query.get('code');
        if (!code || query.get('error')) {
          return redirect(withParam(state.returnTo, 'calendar', 'declined'));
        }
        try {
          await calendar.service.connect(me.login, code);
          return redirect(withParam(state.returnTo, 'calendar', 'connected'));
        } catch (err) {
          console.error(`[calendar] connect failed: ${err instanceof Error ? err.message : 'unknown error'}`);
          return redirect(withParam(state.returnTo, 'calendar', 'failed'));
        }
      }
      return await handleSlackPing(req, res, me, slackPingOffice!);
    } catch (err) {
      console.error(err);
      return send(500, { error: 'Internal error' });
    }

    async function handleSlackPing(request: IncomingMessage, response: ServerResponse, me: Identity | null, officeId: string) {
      if (!slack) {
        return send(404, { error: 'Slack is not enabled' });
      }
      if (request.method !== 'POST') {
        return send(405, { error: 'Method not allowed' });
      }
      if (!me) {
        return send(401, { error: 'Not signed in' });
      }
      const [office]: Office[] = UUID.test(officeId) ? await queryOffices(officeId) : [];
      if (!office) {
        return send(404, { error: 'Office not found' });
      }
      let targetLogin: unknown;
      try {
        targetLogin = (JSON.parse(await readBody(request, MAX_JSON_BYTES)) as { targetLogin?: unknown } | null)?.targetLogin;
      } catch (err) {
        return err instanceof BodyTooLarge ? send(413, { error: 'Body too large' }) : send(400, { error: 'Body must be JSON' });
      }
      if (typeof targetLogin !== 'string' || !targetLogin) {
        return send(400, { error: 'targetLogin is required' });
      }
      if (targetLogin === me.login) {
        return send(400, { error: 'You cannot ping yourself' });
      }
      const claimants = await deskClaims.claimants(office.id);
      if (!Object.hasOwn(claimants, targetLogin)) {
        return send(403, { error: 'Not a desk claimant of this office' });
      }
      if (presence.hasLiveSession(office.id, targetLogin)) {
        return send(409, { error: 'online' });
      }
      const key = `${me.login}>${targetLogin}`;
      const targetName = targetLogin.split('@')[0] || targetLogin;
      const tell = (text: string) => void presence.notifyLogin(office.id, me.login, INTEGRATION_NOTICE_KIND, { from: 'Slack', text });
      const waitMs = pingCooldown.take(key);
      if (waitMs > 0) {
        tell(`You pinged ${targetName} a moment ago. Try again in ${Math.ceil(waitMs / 1000)} seconds.`);
        response.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
        return send(429, { error: 'Pinged too recently', retryAfterSeconds: Math.ceil(waitMs / 1000) });
      }
      try {
        const userId = await slack.directory.userIdForEmail(targetLogin);
        if (!userId) {
          pingCooldown.release(key);
          tell(`${targetName} is not in Slack, so they cannot be reached.`);
          return send(404, { error: 'Not in Slack' });
        }
        const channel = await slack.client.openDm(userId);
        const message = pingMessage({
          senderName: me.name,
          officeName: office.name,
          officeUrl: officeUrl(office.id),
          reply: { officeId: office.id, senderLogin: me.login, senderName: me.name, targetLogin, targetName },
        });
        await slack.client.postMessage({ channel, ...message });
      } catch (err) {
        pingCooldown.release(key);
        tell(`Could not reach ${targetName} on Slack.`);
        console.error(`[slack] ping failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        return send(502, { error: 'Slack is unavailable' });
      }
      tell(`Pinged ${targetName} on Slack.`);
      return send(200, { sent: true });
    }

    async function handleInteraction(request: IncomingMessage, response: ServerResponse) {
      if (!slack) {
        return send(404, { error: 'Slack is not enabled' });
      }
      if (request.method !== 'POST') {
        return send(405, { error: 'Method not allowed' });
      }
      let body: string;
      try {
        body = await readBody(request, MAX_SLACK_BODY_BYTES);
      } catch {
        return send(413, { error: 'Body too large' });
      }
      const check = verifySlackSignature({
        signingSecret: slack.signingSecret,
        timestamp: header(request, 'x-slack-request-timestamp'),
        signature: header(request, 'x-slack-signature'),
        body,
        now: now(),
      });
      if (check !== 'ok') {
        return send(401, { error: check === 'stale' ? 'Stale request' : 'Invalid signature' });
      }
      if (seenInteractions.take(`${header(request, 'x-slack-request-timestamp')}:${header(request, 'x-slack-signature')}`) > 0) {
        return send(200);
      }
      const payload = parseInteraction(body);
      const action = payload?.actions?.find((a) => a.action_id === BE_THERE_ACTION);
      const reply = action ? parsePingReply(action.value) : null;
      if (!reply || !payload?.user?.id || payload.user.id !== (await slack.directory.userIdForEmail(reply.targetLogin))) {
        return send(200);
      }
      const text = 'will be there in 5 minutes';
      if (!presence.notifyLogin(reply.officeId, reply.senderLogin, INTEGRATION_NOTICE_KIND, { from: reply.targetName, text })) {
        await dmPinger(slack, reply.senderLogin, `${reply.targetName} ${text}.`);
      }
      if (payload?.response_url && URL.parse(payload.response_url)?.hostname === 'hooks.slack.com') {
        const confirmation = `You told ${reply.senderName} you will be there in 5 minutes.`;
        void fetchFn(payload.response_url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ replace_original: true, text: confirmation, blocks: [{ type: 'section', text: { type: 'plain_text', text: confirmation } }] }),
          signal: AbortSignal.timeout(5_000),
        }).catch(() => undefined);
      }
      response.statusCode = 200;
      return response.end();
    }
  };
}

interface InteractionPayload {
  user?: { id?: string };
  actions?: { action_id?: string; value?: string }[];
  response_url?: string;
}

function parseInteraction(body: string): InteractionPayload | null {
  try {
    const raw = new URLSearchParams(body).get('payload');
    return raw ? (JSON.parse(raw) as InteractionPayload) : null;
  } catch {
    return null;
  }
}

async function dmPinger(slack: SlackIntegration, login: string, text: string): Promise<void> {
  try {
    const userId = await slack.directory.userIdForEmail(login);
    if (userId) {
      await slack.client.postMessage({ channel: await slack.client.openDm(userId), text });
    }
  } catch (err) {
    console.error(`[slack] reply to the pinger failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}
