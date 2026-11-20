import { readdirSync } from 'node:fs';
import type { DeploymentProvider } from '@officexr/realtime-server/server';
import { createTtlCache } from './ttlCache';

export interface DbVersion {
  expected: string;
  applied: string | null;
  ok: boolean;
}

export interface DeploymentOptions {
  commit: string;
  builtAt?: string;
  expected: string;
  applied: () => Promise<string | undefined>;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

type DbState = { reachable: true; version: DbVersion } | { reachable: false };

const MIGRATION_FILE = /^(\d+)_.+\.sql$/;

const compareVersions = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

const highest = (versions: Iterable<string>): string | undefined => {
  let best: string | undefined;
  for (const v of versions) {
    if (best === undefined || compareVersions(v, best) > 0) {
      best = v;
    }
  }
  return best;
};

export function highestMigration(dir: string): string {
  return highest(readdirSync(dir).flatMap((name) => MIGRATION_FILE.exec(name)?.[1] ?? [])) ?? '';
}

type Query = (text: string) => Promise<{ rows: { version: string }[] }>;

/** `supabase db push` records each applied file's numeric prefix in `supabase_migrations.schema_migrations`. */
export async function pgAppliedVersion(query: Query): Promise<string | undefined> {
  try {
    const { rows } = await query('select version from supabase_migrations.schema_migrations');
    return highest(rows.map((row) => row.version));
  } catch (err) {
    if ((err as { code?: string }).code === '42P01') {
      return undefined;
    }
    throw err;
  }
}

export function createDeployment({ commit, builtAt, expected, applied, ttlMs = 60_000, timeoutMs = 1000, now }: DeploymentOptions): DeploymentProvider {
  const cache = createTtlCache<DbState>({ ttlMs: () => ttlMs, now });
  const load = async (): Promise<DbState> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      const version = await Promise.race([
        applied(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
        }),
      ]);
      return {
        reachable: true,
        version: { expected, applied: version ?? null, ok: version !== undefined && compareVersions(version, expected) >= 0 },
      };
    } catch {
      return { reachable: false };
    } finally {
      clearTimeout(timer);
    }
  };
  const state = () => cache.getOrLoad('db', load);
  return {
    commit,
    readiness: async () => {
      const s = await state();
      if (!s.reachable) {
        return { ok: false, reason: 'db-unreachable' };
      }
      return s.version.ok ? { ok: true } : { ok: false, reason: 'schema-behind' };
    },
    version: async () => {
      const s = await state();
      return { builtAt, db: s.reachable ? s.version : { expected, applied: null, ok: false } };
    },
  };
}
