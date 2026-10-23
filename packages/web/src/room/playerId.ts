import { sessionPlayerId } from '@officexr/sdk';
import type { Identity, Office } from '../../server/api';

const fallbackTabId = crypto.randomUUID().slice(0, 8);

/** A per-tab random id that survives reloads, so a reload reuses its player instead of leaving a ghost. */
function tabId(officeId: string): string {
  const key = `officexr.tab.${officeId}`;
  try {
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = fallbackTabId;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return fallbackTabId;
  }
}

// ponytail: "Duplicate tab" copies sessionStorage, so duplicated debug tabs share a tab id and replace each other.
/** The creator of a debug-enabled office joins each window as its own player; everyone else is their login. */
export function playerIdFor(office: Office, me: Identity): string {
  return office.debug_enabled && office.created_by_login === me.login ? sessionPlayerId(me.login, tabId(office.id)) : me.login;
}
