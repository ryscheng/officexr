#!/usr/bin/env tsx
import { execSync } from 'node:child_process';
import { mkdir, rm, utimes } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  HOLIDAY_PACK_DIR,
  assertCc0,
  downloadKenneyKit,
  listFiles,
  writeHolidayPack,
} from './holiday-pack.ts';

const out = resolve(process.argv[2] ?? 'Kenney_Holiday_Kit_2.0_gltf.zip');
const work = join(process.env.TMPDIR ?? '/tmp', `holiday-zip-${process.pid}`);
const FIXED_TIME = new Date('2024-12-11T00:00:00Z');

async function main(): Promise<void> {
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  const kitZip = join(work, 'kit.zip');
  const kit = join(work, 'kit');
  const pack = join(work, 'pack');
  await downloadKenneyKit(kitZip);
  execSync(`unzip -o -q "${kitZip}" -d "${kit}"`, { stdio: 'inherit' });
  await assertCc0(kit);
  await writeHolidayPack(kit, pack);
  const dir = join(pack, HOLIDAY_PACK_DIR);
  const names = await listFiles(dir);
  for (const name of names) await utimes(join(dir, name), FIXED_TIME, FIXED_TIME);
  await rm(out, { force: true });
  const list = names.map((n) => `${HOLIDAY_PACK_DIR}/${n}`).join('\n');
  execSync(`zip -X -q -@ "${out}"`, { cwd: pack, input: list });
  const sha = execSync(`sha256sum "${out}"`).toString().split(' ')[0];
  console.log(`[holiday-zip] wrote ${out}\n[holiday-zip] sha256 ${sha}`);
  await rm(work, { recursive: true, force: true });
}

main().catch((err: unknown) => {
  console.error('[holiday-zip] failed:', err);
  process.exit(1);
});
