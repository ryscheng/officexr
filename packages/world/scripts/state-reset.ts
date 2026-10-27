#!/usr/bin/env tsx
/**
 * Reset the studio's authored state to its committed-seed baseline.
 *
 * What gets reset:
 *   - `packages/world/rooms/*.json` → keeps only `default.json` and
 *     `default-v2.json` (the bundled seeds). Every other room file
 *     is deleted.
 *   - `packages/world/maps/*.json` → keeps only `default.json`.
 *     Every other map file is deleted.
 *   - `packages/world/cube-kinds.json` → overwritten from
 *     `cube-kinds.default.json`. (This is what the Object editor
 *     reads/writes; if a bug ever clobbers entries — like the Leva
 *     `info.initial` defect did to `colored_block_green` — this
 *     command restores the canonical labels and material defaults.)
 *
 * Safety:
 *   - Prompts for confirmation by default; you have to type `reset`
 *     to proceed.
 *   - Auto-creates a `pre-reset` tarball under `<repo>/backups/`
 *     before touching anything. The path is printed at the start so
 *     you can restore it manually with `tar -xzf <path> -C .` if
 *     anything looks wrong afterwards.
 *
 * Flags:
 *   --yes / -y           Skip the confirmation prompt (CI use).
 *   --skip-backup        Don't auto-backup before resetting.
 *   --dry-run            Print what would change without touching
 *                        anything. Combine with --skip-backup so
 *                        the preview also skips writing a tarball.
 *
 * Usage:
 *   pnpm state:reset                  # interactive
 *   pnpm state:reset --yes            # CI
 *   pnpm state:reset --dry-run
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  basename,
  createBackup,
  formatSize,
  resetState,
} from './state-files.ts';

interface Flags {
  yes: boolean;
  skipBackup: boolean;
  dryRun: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { yes: false, skipBackup: false, dryRun: false };
  for (const a of argv) {
    if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--skip-backup') flags.skipBackup = true;
    else if (a === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  // Preview the blast radius via a dry-run scan first, regardless
  // of whether the user actually passed --dry-run. The user sees a
  // list of files about to be deleted before the confirmation
  // prompt fires.
  const preview = resetState({ dryRun: true });
  const totalDeleted =
    preview.roomsDeleted.length + preview.mapsDeleted.length;

  if (totalDeleted === 0 && !preview.cubeKindsRestored) {
    console.log('Nothing to reset. State is already at the seed baseline.');
    return;
  }

  console.log('Studio state reset preview:');
  if (preview.roomsDeleted.length > 0) {
    console.log(
      `  rooms to delete (${preview.roomsDeleted.length}): ${preview.roomsDeleted.join(', ')}`,
    );
  }
  if (preview.mapsDeleted.length > 0) {
    console.log(
      `  maps to delete  (${preview.mapsDeleted.length}): ${preview.mapsDeleted.join(', ')}`,
    );
  }
  if (preview.cubeKindsRestored) {
    console.log('  cube-kinds.json → restored from cube-kinds.default.json');
  }

  if (flags.dryRun) {
    console.log('\n(dry run; no changes made)');
    return;
  }

  if (!flags.yes) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = (
      await rl.question('\nType "reset" to continue: ')
    ).trim();
    rl.close();
    if (answer !== 'reset') {
      console.log('Aborted — confirmation text did not match.');
      process.exit(2);
    }
  }

  if (!flags.skipBackup) {
    const backup = createBackup({ label: 'pre-reset' });
    console.log(
      `→ pre-reset backup written: ${basename(backup.path)} (${formatSize(backup.size)})`,
    );
  }

  const summary = resetState();
  console.log(
    `✓ reset complete: deleted ${summary.roomsDeleted.length} rooms + ${summary.mapsDeleted.length} maps; cube-kinds.json ${
      summary.cubeKindsRestored ? 'restored from default' : 'unchanged'
    }.`,
  );
}

main().catch((err) => {
  console.error('✗ reset failed:', err);
  process.exit(1);
});
