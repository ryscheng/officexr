// Browser-safe: the web SPA imports this module, so it must stay free of Node and server-only imports.
export { MAX_DESCRIPTION, MAX_NAME } from './officeLimits';

export interface Office {
  id: string;
  name: string;
  description: string | null;
  map_name: string | null;
  created_by_login: string | null;
  debug_enabled: boolean;
}

export interface NewOffice {
  name: string;
  description: string | null;
  mapName: string;
  createdByLogin: string;
}

/** The settings a signed-in user may change; only the keys present are written. */
export type OfficeUpdate = Partial<Pick<NewOffice, 'name' | 'description' | 'mapName'>> & { debugEnabled?: boolean };

export interface Identity {
  login: string;
  name: string;
}

export const isOfficeCreator = (me: Identity, office: Office) => me.login === office.created_by_login;

/** Every signed-in user may change any office's settings. */
export const canEditOffice = (me: Identity | null): me is Identity => me !== null;

/**
 * The env keys `/config.js` serves to every browser: public values only. The JaaS API key id and private key are
 * server-only (`OFFICEXR_JAAS_*`, see `jaasToken.ts`) and must never be added here.
 */
export const RUNTIME_CONFIG_KEYS = [
  'VITE_JAAS_APP_ID',
  'OFFICEXR_ASSET_BASE_URL',
] as const;
