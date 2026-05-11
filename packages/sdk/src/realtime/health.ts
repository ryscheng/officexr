/**
 * Probes a Supabase instance for liveness. Returns true if the auth health
 * endpoint responds (200, 401, or 404 — any of these prove the server is
 * up; only 401/404 mean a misconfigured anon key or missing route, which is
 * still "Supabase is reachable" from the dev-tool's perspective).
 *
 * Used both by the integration test harness (as a `describe.skipIf`
 * predicate) and by the debug-app's promotion logic (gate auto-promote
 * to Supabase mode when the user asks for ≥ 2 bots).
 */
export async function isSupabaseAvailable(
  url: string,
  anonKey: string,
  timeoutMs = 1500,
): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${url}/auth/v1/health`, {
      signal: ctrl.signal,
      headers: { apikey: anonKey },
    });
    clearTimeout(timer);
    return res.ok || res.status === 401 || res.status === 404;
  } catch {
    return false;
  }
}
