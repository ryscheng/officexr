export function ephemeralPort(): number {
  // 50000-60000 range — avoid privileged ports + common services.
  return 50000 + Math.floor(Math.random() * 10000);
}

export async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor: predicate did not become true');
}
