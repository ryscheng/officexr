/** The realtime join token for the signed-in user, or `undefined` when the web server has none to give (404). */
export async function fetchRealtimeToken(fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  const res = await fetchFn('/api/realtime-token');
  if (res.status === 404) {
    return undefined;
  }
  if (!res.ok) {
    throw new Error(`Realtime token request failed (${res.status})`);
  }
  return ((await res.json()) as { token: string }).token;
}
