const POLICY_TIMEOUT_MS = 2_000;

/** Only the creator of a debug-enabled office may hold several live sessions in it. */
export function officeAllowsMultiSession(
  office: { debug_enabled?: unknown; created_by_login?: unknown },
  login: string,
): boolean {
  return office.debug_enabled === true && office.created_by_login === login;
}

/** Whether `login` may hold several live sessions in `officeId`, per the
 * office JSON at `officeUrl` (which contains `{id}`). Any failure resolves `false`. */
export async function fetchSessionPolicy(
  officeUrl: string,
  officeId: string,
  login: string,
  fetchFn: typeof fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(officeUrl.replace('{id}', encodeURIComponent(officeId)), {
      signal: AbortSignal.timeout(POLICY_TIMEOUT_MS),
    });
    if (res.status !== 200) {
      await res.body?.cancel();
      return false;
    }
    const office: unknown = await res.json();
    if (!office || typeof office !== 'object') {
      return false;
    }
    return officeAllowsMultiSession(office, login);
  } catch {
    return false;
  }
}
