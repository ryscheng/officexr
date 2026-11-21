import { clearPreviewToken } from '@officexr/server/preview-token';
import { apiFetch, paths } from './apiOrigin';
import { errorMessage } from './useApi';

export async function signOut(): Promise<void> {
  const res = await apiFetch(paths.signOut, { method: 'POST' });
  if (!res.ok) {
    throw new Error(errorMessage(res, await res.json().catch(() => null)));
  }
  clearPreviewToken();
  window.location.assign('/');
}
