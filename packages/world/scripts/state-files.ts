/**
 * Shared helpers for the `state:backup` and `state:reset` CLI
 * scripts. Encapsulates:
 *
 *   - the list of directories/files that count as "studio state"
 *     (the user's authored work + the live cube-kind catalog)
 *   - which filenames are committed seeds vs user-authored
 *   - the backup tarball builder
 *   - the reset routine
 *
 * Exported as standalone functions so they're unit-testable without
 * spinning up a real CLI.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** packages/world/ */
export const PACKAGE_ROOT = join(__dirname, '..');
/** Repo root — `packages/world/` is one workspace under it. */
export const REPO_ROOT = join(PACKAGE_ROOT, '..', '..');

export const ROOMS_DIR = join(PACKAGE_ROOT, 'rooms');
export const MAPS_DIR = join(PACKAGE_ROOT, 'maps');
export const CUBE_KINDS_FILE = join(PACKAGE_ROOT, 'cube-kinds.json');
export const CUBE_KINDS_DEFAULT_FILE = join(
  PACKAGE_ROOT,
  'cube-kinds.default.json',
);
export const BACKUPS_DIR = join(REPO_ROOT, 'backups');

/**
 * Filenames committed to git as bundled seeds. The reset routine
 * keeps these and deletes everything else in their directories;
 * the backup routine archives them along with the user files (a
 * backup is a snapshot of *current* state, including modifications
 * to the seed files).
 *
 * Sourced from the studio-restructure task plan: the rooms seed
 * is `default-v2`, the legacy `default` is kept for migration
 * round-tripping, and the maps seed is just `default`.
 */
export const SEED_FILES = {
  rooms: new Set(['default.json', 'default-v2.json']),
  maps: new Set(['default.json']),
} as const;

/**
 * The relative paths (from REPO_ROOT) of every studio-state file or
 * directory. Used by `createBackup` to feed `tar` and by the reset
 * routine to know what to operate on.
 */
export const STATE_PATHS = [
  'packages/world/rooms',
  'packages/world/maps',
  'packages/world/cube-kinds.json',
] as const;

export interface BackupResult {
  /** Absolute path to the generated tarball. */
  path: string;
  /** Bytes on disk. */
  size: number;
  /** Number of files included. */
  fileCount: number;
}

/**
 * Build a gzipped tar archive of the current studio state and
 * write it under `<repo>/backups/`. Returns the path + metadata.
 *
 * The filename embeds an ISO timestamp + an optional `label`
 * (e.g. `pre-reset`) so the user can tell at a glance why each
 * backup was made.
 *
 * Uses the system `tar` (every macOS/Linux dev box has it; bsdtar
 * on Mac and GNU tar on Linux both accept `-czf` + `-C`).
 */
export function createBackup(opts: { label?: string } = {}): BackupResult {
  ensureDir(BACKUPS_DIR);

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace(/Z$/, '');
  const suffix = opts.label ? `-${opts.label}` : '';
  const filename = `officexr-studio-${stamp}${suffix}.tar.gz`;
  const dest = join(BACKUPS_DIR, filename);

  // -C cd into REPO_ROOT so paths inside the tarball stay
  // relative to the workspace (extracting from REPO_ROOT
  // round-trips cleanly).
  execFileSync(
    'tar',
    ['-czf', dest, '-C', REPO_ROOT, ...STATE_PATHS],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );

  return {
    path: dest,
    size: statSync(dest).size,
    fileCount: countStateFiles(),
  };
}

export interface ResetSummary {
  roomsDeleted: string[];
  mapsDeleted: string[];
  cubeKindsRestored: boolean;
}

/**
 * Reset studio state to its committed-seed baseline:
 *
 *   - Delete every file in `rooms/` that isn't in `SEED_FILES.rooms`.
 *   - Delete every file in `maps/` that isn't in `SEED_FILES.maps`.
 *   - Overwrite `cube-kinds.json` with `cube-kinds.default.json`.
 *
 * Returns a summary of what was changed. With `dryRun: true`, walks
 * the directories but doesn't touch anything — used to preview the
 * blast radius before confirming.
 */
export function resetState(opts: { dryRun?: boolean } = {}): ResetSummary {
  const summary: ResetSummary = {
    roomsDeleted: [],
    mapsDeleted: [],
    cubeKindsRestored: false,
  };

  for (const [dir, seeds] of [
    [ROOMS_DIR, SEED_FILES.rooms],
    [MAPS_DIR, SEED_FILES.maps],
  ] as const) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (seeds.has(entry)) continue;
      if (!entry.endsWith('.json')) continue; // skip stray non-JSON
      const target = join(dir, entry);
      if (!opts.dryRun) rmSync(target);
      if (dir === ROOMS_DIR) summary.roomsDeleted.push(entry);
      else summary.mapsDeleted.push(entry);
    }
  }

  if (existsSync(CUBE_KINDS_DEFAULT_FILE)) {
    if (!opts.dryRun) {
      copyFileSync(CUBE_KINDS_DEFAULT_FILE, CUBE_KINDS_FILE);
    }
    summary.cubeKindsRestored = true;
  }

  return summary;
}

/** Count files inside the state paths — for the post-backup summary. */
function countStateFiles(): number {
  let n = 0;
  for (const rel of STATE_PATHS) {
    const abs = join(REPO_ROOT, rel);
    if (!existsSync(abs)) continue;
    try {
      const stat = readdirSync(abs);
      n += stat.length;
    } catch {
      // It's a file, not a directory.
      n += 1;
    }
  }
  return n;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

/** Format a tarball size for the summary log (`12.4 KB` etc.). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Filename basename. Re-export so the CLIs don't need their own
 * path import. */
export { basename };
