import { withPreviewTokenHeader } from '@officexr/server/preview-token';

/** Studio API origin without a trailing slash; `''` keeps every call same-origin. */
export const STUDIO_API_ORIGIN = (import.meta.env.VITE_STUDIO_API_ORIGIN ?? '').replace(/\/$/, '');

/** The web backend's origin, which owns Google sign-in. */
export const WEB_API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

export const studioApiUrl = (path: string) => `${STUDIO_API_ORIGIN}${path}`;

const isStudioApi = (input: RequestInfo | URL) =>
  new URL(input instanceof Request ? input.url : input, window.location.href).origin ===
  (STUDIO_API_ORIGIN ? new URL(STUDIO_API_ORIGIN).origin : window.location.origin);

// The studio API gates every request on the shared session cookie, which a cross-origin fetch only sends with credentials;
// a preview deployment the cookie can't reach sends its preview token instead, to the studio API alone.
export const studioFetch: typeof fetch = (input, init) =>
  fetch(input, { credentials: 'include', ...(isStudioApi(input) ? withPreviewTokenHeader(input, init) : init) });

export const paths = {
  me: '/api/me',
  maps: '/api/maps',
  rooms: '/api/rooms',
  layouts: '/api/layouts',
  bakedLayouts: '/api/baked-layouts',
  worldObjectKinds: '/api/world-object-kinds',
  worldSettings: '/api/world-settings',
  sounds: '/api/sounds',
  agentTokenRequests: '/api/agent-token-requests',
};

/** `{ basePath, fetch }` for a world `Filesystem*Storage` talking to the studio API at `path`. */
export const studioApiOptions = (path: string) => ({ basePath: studioApiUrl(path), fetch: studioFetch });
