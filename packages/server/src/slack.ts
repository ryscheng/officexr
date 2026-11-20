import { createHmac, timingSafeEqual } from 'node:crypto';
import { createTtlCache } from './ttlCache';

const SLACK_API = 'https://slack.com/api/';
const REQUEST_TIMEOUT_MS = 5_000;
export const SIGNATURE_WINDOW_SECONDS = 5 * 60;
/** The limits of `ZClaimantSlack`, so one long status cannot make listDeskClaims fail. */
const MAX_STATUS_TEXT = 200;
const MAX_STATUS_EMOJI = 100;

export type SignatureCheck = 'ok' | 'invalid' | 'stale';

export interface SignatureInput {
  signingSecret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  /** The raw body, byte for byte: the signature covers it. */
  body: string;
  now?: number;
}

export function verifySlackSignature({ signingSecret, timestamp, signature, body, now = Date.now() }: SignatureInput): SignatureCheck {
  const seconds = Number(timestamp);
  if (!timestamp || !signature || !Number.isInteger(seconds)) {
    return 'invalid';
  }
  const expected = Buffer.from(`v0=${createHmac('sha256', signingSecret).update(`v0:${timestamp}:${body}`).digest('hex')}`);
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return 'invalid';
  }
  return Math.abs(now / 1000 - seconds) > SIGNATURE_WINDOW_SECONDS ? 'stale' : 'ok';
}

export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly slackError: string,
  ) {
    super(`Slack ${method} failed: ${slackError}`);
  }
}

export interface SlackStatus {
  text: string;
  emoji?: string;
}

export interface SlackClient {
  lookupUserByEmail: (email: string) => Promise<string | null>;
  openDm: (userId: string) => Promise<string>;
  postMessage: (message: { channel: string; text: string; blocks?: unknown[] }) => Promise<void>;
  userStatus: (userId: string) => Promise<SlackStatus | null>;
}

export function createSlackClient(botToken: string, fetchFn: typeof fetch = fetch): SlackClient {
  const call = async (method: string, params: Record<string, unknown>, encoding: 'json' | 'form'): Promise<Record<string, unknown>> => {
    const res = await fetchFn(`${SLACK_API}${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${botToken}`,
        'content-type': encoding === 'json' ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded',
      },
      body: encoding === 'json' ? JSON.stringify(params) : new URLSearchParams(params as Record<string, string>).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok !== true) {
      throw new SlackApiError(method, body.error ?? `http_${res.status}`);
    }
    return body;
  };
  return {
    async lookupUserByEmail(email) {
      try {
        const body = (await call('users.lookupByEmail', { email }, 'form')) as { user?: { id?: string } };
        return body.user?.id ?? null;
      } catch (err) {
        if (err instanceof SlackApiError && err.slackError === 'users_not_found') {
          return null;
        }
        throw err;
      }
    },
    async openDm(userId) {
      const body = (await call('conversations.open', { users: userId }, 'json')) as { channel?: { id?: string } };
      if (!body.channel?.id) {
        throw new SlackApiError('conversations.open', 'no_channel');
      }
      return body.channel.id;
    },
    async postMessage(message) {
      await call('chat.postMessage', message, 'json');
    },
    async userStatus(userId) {
      try {
        const body = (await call('users.profile.get', { user: userId }, 'form')) as { profile?: { status_text?: string; status_emoji?: string } };
        const text = body.profile?.status_text?.trim() ?? '';
        const emoji = body.profile?.status_emoji?.trim() ?? '';
        return text || emoji ? { text: text.slice(0, MAX_STATUS_TEXT), ...(emoji && { emoji: emoji.slice(0, MAX_STATUS_EMOJI) }) } : null;
      } catch (err) {
        if (err instanceof SlackApiError && (err.slackError === 'missing_scope' || err.slackError === 'user_not_found')) {
          return null;
        }
        throw err;
      }
    },
  };
}

export interface SlackDirectoryOptions {
  client: SlackClient;
  now?: () => number;
  userCacheMs?: number;
  missCacheMs?: number;
  failureCacheMs?: number;
  statusCacheMs?: number;
}

export interface SlackDirectory {
  userIdForEmail: (email: string) => Promise<string | null>;
  statuses: (emails: string[]) => Promise<Record<string, SlackStatus>>;
}

export function createSlackDirectory({
  client,
  now = Date.now,
  userCacheMs = 60 * 60_000,
  missCacheMs = 10 * 60_000,
  failureCacheMs = 60_000,
  statusCacheMs = 2 * 60_000,
}: SlackDirectoryOptions): SlackDirectory {
  type Lookup = { id: string | null; failed?: boolean };
  const users = createTtlCache<Lookup>({ ttlMs: (l) => (l.failed ? failureCacheMs : l.id ? userCacheMs : missCacheMs), now });
  const statuses = createTtlCache<SlackStatus | null>({ ttlMs: () => statusCacheMs, now });
  const userIdForEmail = async (email: string): Promise<string | null> => {
    const key = email.toLowerCase();
    const found = await users.getOrLoad(key, async () => {
      try {
        return { id: await client.lookupUserByEmail(key) };
      } catch (err) {
        console.error(`[slack] user lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
        return { id: null, failed: true };
      }
    });
    return found.id;
  };
  return {
    userIdForEmail,
    async statuses(emails) {
      const entries = await Promise.all(
        emails.map(async (email) => {
          const id = await userIdForEmail(email);
          if (!id) {
            return [email, null] as const;
          }
          const status = await statuses.getOrLoad(id, () =>
            client.userStatus(id).catch((err: unknown) => {
              console.error(`[slack] status lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
              return null;
            }),
          );
          return [email, status] as const;
        }),
      );
      return Object.fromEntries(entries.filter((entry): entry is [string, SlackStatus] => entry[1] !== null));
    },
  };
}

/** Escapes Slack markup and breaks `scheme://` so a name cannot become a link. */
const safeName = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/:\/\//g, ':\u200b//');

export const OPEN_OFFICE_ACTION = 'open_office';
export const BE_THERE_ACTION = 'be_there_in_5';

export interface PingReply {
  officeId: string;
  senderLogin: string;
  senderName: string;
  /** Checked against the Slack user who clicks, so only the target can reply. */
  targetLogin: string;
  targetName: string;
}

export interface PingMessageInput {
  senderName: string;
  officeName: string;
  officeUrl: string;
  reply: PingReply;
}

export function pingMessage({ senderName, officeName, officeUrl, reply }: PingMessageInput): { text: string; blocks: unknown[] } {
  const text = `${safeName(senderName)} is looking for you in ${safeName(officeName)} — Open office`;
  return {
    text,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${safeName(senderName)}* is looking for you in *${safeName(officeName)}* — <${officeUrl}|Open office>` },
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Open office' }, url: officeUrl, action_id: OPEN_OFFICE_ACTION, style: 'primary' },
          { type: 'button', text: { type: 'plain_text', text: "I'll be there in 5" }, action_id: BE_THERE_ACTION, value: JSON.stringify(reply) },
        ],
      },
    ],
  };
}

export function parsePingReply(value: unknown): PingReply | null {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    const { officeId, senderLogin, senderName, targetLogin, targetName } = JSON.parse(value) as Partial<PingReply>;
    return typeof officeId === 'string' && typeof senderLogin === 'string' && typeof senderName === 'string' && typeof targetLogin === 'string' && typeof targetName === 'string'
      ? { officeId, senderLogin, senderName, targetLogin, targetName }
      : null;
  } catch {
    return null;
  }
}
