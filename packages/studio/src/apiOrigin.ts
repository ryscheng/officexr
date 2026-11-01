/** Studio API origin without a trailing slash; `''` keeps every call same-origin. */
export const STUDIO_API_ORIGIN = (import.meta.env.VITE_STUDIO_API_ORIGIN ?? '').replace(/\/$/, '');

/** The web backend's origin, which owns Google sign-in. */
export const WEB_API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

export const studioApiUrl = (path: string) => `${STUDIO_API_ORIGIN}${path}`;

// The studio API gates every request on the shared session cookie, which a cross-origin fetch only sends with credentials.
export const studioFetch: typeof fetch = (input, init) => fetch(input, { credentials: 'include', ...init });

export const paths = {
  me: '/api/me',
  maps: '/api/maps',
  rooms: '/api/rooms',
  layouts: '/api/layouts',
  // ponytail: drei's useGLTF fetches these without credentials, so cross-origin editor previews of baked layouts 401.
  bakedLayouts: '/api/baked-layouts',
  worldObjectKinds: '/api/world-object-kinds',
  worldSettings: '/api/world-settings',
};

/** `{ basePath, fetch }` for a world `Filesystem*Storage` talking to the studio API at `path`. */
export const studioApiOptions = (path: string) => ({ basePath: studioApiUrl(path), fetch: studioFetch });
