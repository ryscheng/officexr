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

/** The settings a creator may change; only the keys present are written. */
export type OfficeUpdate = Partial<Pick<NewOffice, 'name' | 'description' | 'mapName'>> & { debugEnabled?: boolean };

export interface Identity {
  login: string;
  name: string;
}

/** Only an office's creator may change its settings; offices without a recorded creator have none. */
export const isOfficeCreator = (me: Identity, office: Office) => me.login === office.created_by_login;

export const RUNTIME_CONFIG_KEYS = [
  'VITE_JAAS_APP_ID',
  'VITE_JAAS_API_KEY_ID',
  'VITE_JAAS_PRIVATE_KEY',
  'OFFICEXR_ASSET_BASE_URL',
] as const;
