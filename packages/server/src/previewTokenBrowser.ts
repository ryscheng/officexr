/**
 * Preview deployments (e.g. `*.pages.dev`) are cross-site with the backend, so the session cookie never reaches it.
 * Sign-in hands them a short-lived token in the URL fragment instead; it lives in sessionStorage and rides on API
 * calls as `Authorization: Bearer`.
 */
export const PREVIEW_TOKEN_PARAM = 'officexr_token';
const STORAGE_KEY = 'officexr.previewToken';

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Where the token lives when sessionStorage refuses writes (e.g. some private modes). */
let memoryToken: string | null = null;

function sessionStore(): TokenStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Seconds since the epoch at which the JWT `token` expires, or `null` if it carries no readable `exp`. */
function expiry(token: string): number | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload)) as { exp?: unknown };
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/** Moves a sign-in's token from the URL fragment into storage and strips it from the address bar and history. */
export function capturePreviewToken(loc: Location = window.location, hist: History = window.history, storage = sessionStore()) {
  const params = new URLSearchParams(loc.hash.slice(1));
  const token = params.get(PREVIEW_TOKEN_PARAM);
  if (token === null) {
    return;
  }
  try {
    storage?.setItem(STORAGE_KEY, token);
  } catch {
    memoryToken = token;
  }
  params.delete(PREVIEW_TOKEN_PARAM);
  const hash = params.toString();
  hist.replaceState(hist.state, '', `${loc.pathname}${loc.search}${hash ? `#${hash}` : ''}`);
}

/** The stored preview token, or `null` when there is none or it has expired (an expired one is dropped). */
export function previewToken(storage = sessionStore(), now = Date.now()): string | null {
  let token = memoryToken;
  try {
    token = storage?.getItem(STORAGE_KEY) ?? memoryToken;
  } catch {
    // Unreadable storage leaves the in-memory fallback.
  }
  if (token === null) {
    return null;
  }
  const exp = expiry(token);
  if (exp === null || exp * 1000 <= now) {
    clearPreviewToken(storage);
    return null;
  }
  return token;
}

export function clearPreviewToken(storage = sessionStore()) {
  memoryToken = null;
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored that could be read back.
  }
}

/** `init` for fetching `input` with the stored preview token as `Authorization: Bearer`, or `init` unchanged without one. */
export function withPreviewTokenHeader(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  const token = previewToken();
  if (token === null) {
    return init;
  }
  // `init.headers` replaces a `Request`'s own headers, so they are carried over.
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}
