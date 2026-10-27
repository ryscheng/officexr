#!/usr/bin/env tsx
/**
 * Backup the studio's authored state — `rooms/`, `maps/`, and the
 * `cube-kinds.json` catalog — into a timestamped gzipped tarball
 * under `<repo>/backups/`.
 *
 * Usage:
 *   pnpm state:backup                # default name
 *   pnpm state:backup --label pre-rename
 *
 * The label suffixes the filename so backups taken before different
 * operations stay distinguishable. Useful naming: `--label pre-reset`
 * (the reset CLI uses this automatically before nuking state).
 */
import { createBackup, formatSize } from './state-files.ts';

const args = process.argv.slice(2);
const labelIdx = args.indexOf('--label');
const label =
  labelIdx >= 0 && labelIdx + 1 < args.length ? args[labelIdx + 1] : undefined;

try {
  const result = createBackup({ label });
  console.log(
    `✓ wrote ${result.path}\n  ${formatSize(result.size)} · ${
      result.fileCount
    } top-level state files`,
  );
} catch (err) {
  console.error('✗ backup failed:', (err as Error).message);
  process.exit(1);
}
