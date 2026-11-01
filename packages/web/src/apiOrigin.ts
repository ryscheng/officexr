const enc = encodeURIComponent;

/** Backend origin without a trailing slash; `''` keeps every call same-origin. */
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

export const apiUrl = (path: string) => `${API_ORIGIN}${path}`;

// The session cookie is SameSite=Lax, so a cross-origin backend only sees it with credentials included.
export const apiFetch = (path: string, init?: RequestInit) => fetch(apiUrl(path), { credentials: 'include', ...init });

export const wsUrl = () => `${(API_ORIGIN || window.location.origin).replace(/^http/, 'ws')}/ws`;

export const paths = {
  me: '/api/me',
  offices: '/api/offices',
  office: (id: string) => `/api/offices/${enc(id)}`,
  character: (id: string) => `/api/offices/${enc(id)}/character`,
  realtimeToken: '/api/realtime-token',
  sessions: (id: string, login: string, token?: string) =>
    `/rooms/${enc(id)}/sessions?login=${enc(login)}${token ? `&token=${enc(token)}` : ''}`,
  signIn: '/auth/google',
  signOut: '/auth/logout',
  maps: '/api/maps',
  rooms: '/api/rooms',
  layouts: '/api/layouts',
  worldObjectKinds: '/api/world-object-kinds',
};
