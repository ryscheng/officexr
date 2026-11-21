import type { BlockedVariant } from './Blocked';

/** The blocked variant for a failed API call: `status` is absent when the request never got an answer. */
export function fetchFailureVariant(status: number | undefined, notFound: BlockedVariant = 'officeNotFound'): BlockedVariant {
  if (status === 404) {
    return notFound;
  }
  if (status === undefined && !navigator.onLine) {
    return 'offline';
  }
  return 'cannotConnect';
}

export const fetchFailureDetails = (message: string, status?: number, id?: string): string =>
  [status === undefined ? null : `HTTP ${status}`, id, message].filter(Boolean).join('\n');
