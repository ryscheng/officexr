import type { WorldConstants } from '@officexr/sdk';
import type { WorldConstantsPushFailure } from '@officexr/world/scenes';

const DEFAULT_TIMEOUT_MS = 5000;

/** PUTs `doc` to every target's admin endpoint in parallel; resolves with the targets that did not answer 204. */
export async function pushWorldConstants(opts: {
  targets: readonly string[];
  token: string | undefined;
  doc: WorldConstants;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<WorldConstantsPushFailure[]> {
  const { targets, token, doc, fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const results = await Promise.all(
    targets.map(async (target): Promise<WorldConstantsPushFailure | null> => {
      try {
        const r = await fetchFn(`${target.replace(/\/$/, '')}/admin/world-constants`, {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token ?? ''}`,
          },
          body: JSON.stringify(doc),
          signal: AbortSignal.timeout(timeoutMs),
        });
        return r.status === 204 ? null : { target, status: r.status };
      } catch (err) {
        return { target, error: (err as Error).message };
      }
    }),
  );
  return results.filter((f) => f !== null);
}

/** Comma-separated base URLs, e.g. the `OFFICEXR_WORLD_CONSTANTS_PUSH_TARGETS` value. */
export function parsePushTargets(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}
