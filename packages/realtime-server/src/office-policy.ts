const POLICY_TIMEOUT_MS = 2_000;

/** Whether `login` may hold several live sessions in `officeId`: only the
 * creator of a debug-enabled office may. `officeUrl` contains `{id}`.
 * Any failure resolves `false`. */
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
      return false;
    }
    const office: unknown = await res.json();
    if (!office || typeof office !== 'object') {
      return false;
    }
    const { debug_enabled, created_by_login } = office as Record<string, unknown>;
    return debug_enabled === true && created_by_login === login;
  } catch {
    return false;
  }
}
