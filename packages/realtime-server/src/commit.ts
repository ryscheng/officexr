import { execFileSync } from 'node:child_process';

export function resolveCommit(env: Record<string, string | undefined>): string {
  if (env.OFFICEXR_COMMIT) {
    return env.OFFICEXR_COMMIT;
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 }).trim() || 'dev';
  } catch {
    return 'dev';
  }
}
