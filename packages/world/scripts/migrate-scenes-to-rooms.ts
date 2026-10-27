#!/usr/bin/env tsx
/**
 * One-shot migration: convert every `packages/world/scenes/*.json`
 * file from v1 or v2 to a v3 `RoomDocument` and write it to
 * `packages/world/rooms/<name>.json`.
 *
 * Idempotent: if `rooms/<name>.json` already exists it is overwritten
 * (so re-running after touching a source scene is safe).
 *
 * The script does NOT delete the legacy `scenes/` directory — the
 * Vite plugin still serves it via the back-compat path until Task 2
 * lands the new `/api/rooms` endpoint. Delete `scenes/` manually (or
 * via a follow-up commit) once the new endpoint is in.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deserializeScene,
  migrateToV3,
  serializeRoom,
} from '../src/scenes/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');
const SCENES_DIR = join(packageRoot, 'scenes');
const ROOMS_DIR = join(packageRoot, 'rooms');

async function main(): Promise<void> {
  if (!existsSync(SCENES_DIR)) {
    console.error(`[migrate] no scenes directory at ${SCENES_DIR} — nothing to do.`);
    process.exit(0);
  }
  await mkdir(ROOMS_DIR, { recursive: true });

  const entries = await readdir(SCENES_DIR);
  const jsonFiles = entries.filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) {
    console.error(`[migrate] no .json scenes in ${SCENES_DIR} — nothing to do.`);
    process.exit(0);
  }

  let migrated = 0;
  for (const file of jsonFiles) {
    const src = join(SCENES_DIR, file);
    const raw = await readFile(src, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`[migrate] skip ${file}: not valid JSON (${(err as Error).message})`);
      continue;
    }
    let room;
    try {
      room = migrateToV3(deserializeScene(parsed));
    } catch (err) {
      console.error(`[migrate] skip ${file}: ${(err as Error).message}`);
      continue;
    }
    // Defend against `name` field disagreeing with the source filename:
    // if they differ, prefer the filename so the migrator output matches
    // the dev's mental model of "scenes/foo.json → rooms/foo.json".
    const expectedName = file.replace(/\.json$/, '');
    if (room.name !== expectedName) {
      console.error(
        `[migrate] note: ${file} internal name "${room.name}" → using filename "${expectedName}"`,
      );
      room.name = expectedName;
    }
    const out = serializeRoom({
      name: room.name,
      title: room.title,
      commands: room.commands,
      groups: room.groups,
    });
    // Preserve the original updatedAt when present so migration
    // doesn't bump every room's modified-time to "now". `!== undefined`
    // not truthy, so a legitimate 0 timestamp survives.
    if (room.updatedAt !== undefined) out.updatedAt = room.updatedAt;
    const dest = join(ROOMS_DIR, `${room.name}.json`);
    await writeFile(dest, JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log(`[migrate] ${file} → rooms/${room.name}.json`);
    migrated++;
  }

  console.log(`[migrate] done — ${migrated} room(s) written to ${ROOMS_DIR}`);
}

main().catch((err: unknown) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
