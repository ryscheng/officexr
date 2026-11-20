import { calendarStatus, STATUS_WINDOW_MS, type CalendarStatus } from './calendarStatus';
import { GoogleCalendarError, type GoogleCalendarClient } from './googleCalendar';
import type { SecretBox } from './secretBox';
import { createTtlCache } from './ttlCache';

export interface CalendarLinks {
  getMany: (logins: string[]) => Promise<Record<string, string>>;
  set: (login: string, sealedRefreshToken: string) => Promise<void>;
  /** With `onlySealed`, removes the row only while it still holds that value, so a stale lookup cannot delete a newer link. */
  remove: (login: string, onlySealed?: string) => Promise<string | null>;
}

export interface CalendarServiceOptions {
  client: GoogleCalendarClient;
  links: CalendarLinks;
  box: SecretBox;
  now?: () => number;
  cacheMs?: number;
  failureCacheMs?: number;
}

export interface CalendarService {
  connect: (login: string, code: string) => Promise<void>;
  disconnect: (login: string) => Promise<void>;
  isConnected: (login: string) => Promise<boolean>;
  statuses: (logins: string[]) => Promise<Record<string, CalendarStatus>>;
}

export function createCalendarService({ client, links, box, now = Date.now, cacheMs = 3 * 60_000, failureCacheMs = 60_000 }: CalendarServiceOptions): CalendarService {
  const cache = createTtlCache<CalendarStatus | undefined>({ ttlMs: (status) => (status ? cacheMs : failureCacheMs), now });
  const lookup = async (login: string, sealed: string | undefined): Promise<CalendarStatus | undefined> => {
    if (sealed === undefined) {
      return undefined;
    }
    try {
      const accessToken = await client.accessToken(box.decrypt(sealed, login));
      const at = new Date(now());
      return calendarStatus(await client.freeBusy(accessToken, at, new Date(at.getTime() + STATUS_WINDOW_MS)), at);
    } catch (err) {
      if (err instanceof GoogleCalendarError && err.code === 'invalid_grant') {
        await links.remove(login, sealed);
      } else {
        console.error(`[calendar] free/busy lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
      return undefined;
    }
  };
  return {
    async connect(login, code) {
      const { refreshToken } = await client.exchangeCode(code);
      await links.set(login, box.encrypt(refreshToken, login));
      cache.delete(login);
    },
    async disconnect(login) {
      cache.delete(login);
      const sealed = await links.remove(login);
      if (sealed) {
        await client.revoke(box.decrypt(sealed, login)).catch(() => undefined);
      }
    },
    async isConnected(login) {
      return Object.hasOwn(await links.getMany([login]), login);
    },
    async statuses(logins) {
      const stale = logins.filter((login) => !cache.peek(login));
      const sealed = stale.length ? await links.getMany(stale) : {};
      for (const login of stale) {
        if (!Object.hasOwn(sealed, login)) {
          cache.set(login, undefined);
        }
      }
      const entries = await Promise.all(logins.map(async (login) => [login, await cache.getOrLoad(login, () => lookup(login, Object.hasOwn(sealed, login) ? sealed[login] : undefined))] as const));
      return Object.fromEntries(entries.filter((entry): entry is [string, CalendarStatus] => entry[1] !== undefined));
    },
  };
}
