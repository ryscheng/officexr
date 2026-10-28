/** The realtime join token for the signed-in user, or `undefined` when the web server has none to give (404). */
export async function fetchRealtimeToken(fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  const res = await fetchFn('/api/realtime-token');
  if (res.status === 404) {
    return undefined;
  }
  if (!res.ok) {
    throw new Error(`Realtime token request failed (${res.status})`);
  }
  const { token } = (await res.json()) as { token?: unknown };
  if (typeof token !== 'string') {
    throw new Error('Realtime token response had no token');
  }
  return token;
}
