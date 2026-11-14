import { withPreviewTokenHeader } from '@officexr/server/preview-token';

/** Backend origin without a trailing slash; `''` keeps every call same-origin. */
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

export const apiUrl = (path: string) => `${API_ORIGIN}${path}`;

/**
 * The session cookie is SameSite=Lax, so a cross-origin backend only sees it with credentials included. A preview
 * deployment has no cookie the backend can see and sends its preview token instead.
 */
export const apiFetch = (path: string, init?: RequestInit) => fetch(apiUrl(path), { credentials: 'include', ...withPreviewTokenHeader(path, init) });

export const wsUrl = () => `${(API_ORIGIN || window.location.origin).replace(/^http/, 'ws')}/ws`;

export const paths = {
  me: '/api/me',
  offices: '/api/offices',
  office: (id: string) => `/api/offices/${encodeURIComponent(id)}`,
  character: (id: string) => `/api/offices/${encodeURIComponent(id)}/character`,
  realtimeToken: '/api/realtime-token',
  voiceToken: (id: string) => `/api/offices/${encodeURIComponent(id)}/voice-token`,
  sessions: (id: string, login: string, token?: string) =>
    `/rooms/${encodeURIComponent(id)}/sessions?login=${encodeURIComponent(login)}${token ? `&token=${encodeURIComponent(token)}` : ''}`,
  signIn: '/auth/google',
  signOut: '/auth/logout',
  maps: '/api/maps',
  rooms: '/api/rooms',
  layouts: '/api/layouts',
  worldObjectKinds: '/api/world-object-kinds',
};
