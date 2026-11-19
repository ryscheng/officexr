import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LEDGER_FILE, mergeBundledDefaults } from '../../bundled-defaults.ts';

const catalog = (...ids: string[]) =>
  JSON.stringify({ schemaVersion: 1, updatedAt: 1, kinds: ids.map((id) => ({ id, label: id })) });

let root: string;
let bundled: string;
let data: string;

async function put(dir: string, rel: string, body: string) {
  await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
  await writeFile(path.join(dir, rel), body);
}

const kindIds = async () => JSON.parse(await readFile(path.join(data, 'world-object-kinds.json'), 'utf8')).kinds.map((k: { id: string }) => k.id);

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'bundled-'));
  bundled = path.join(root, 'bundled');
  data = path.join(root, 'data');
  await put(bundled, 'world-object-kinds.json', catalog('a', 'b', 'pool'));
  await put(bundled, 'maps/old.json', 'bundled-old');
  await put(bundled, 'maps/pool_party.json', 'bundled-pool');
  await put(bundled, 'rooms/pool-party.json', 'bundled-room');
});

afterEach(() => rm(root, { recursive: true, force: true }));

describe('mergeBundledDefaults', () => {
  it('adds new kinds and files to an old data dir without a ledger, keeping existing ones', async () => {
    await put(data, 'world-object-kinds.json', catalog('a', 'b'));
    await put(data, 'maps/old.json', 'mine');
    await mergeBundledDefaults(data, bundled);
    expect(await kindIds()).toEqual(['a', 'b', 'pool']);
    expect(await readFile(path.join(data, 'maps/old.json'), 'utf8')).toBe('mine');
    expect(await readFile(path.join(data, 'maps/pool_party.json'), 'utf8')).toBe('bundled-pool');
    expect(await readFile(path.join(data, 'rooms/pool-party.json'), 'utf8')).toBe('bundled-room');
  });

  it('does not bring back a kind or file deleted after the ledger exists', async () => {
    await put(data, 'world-object-kinds.json', catalog('a', 'b', 'pool'));
    await put(data, 'maps/old.json', 'x');
    await put(data, 'maps/pool_party.json', 'x');
    await put(data, 'rooms/pool-party.json', 'x');
    await mergeBundledDefaults(data, bundled);
    await writeFile(path.join(data, 'world-object-kinds.json'), catalog('a', 'b'));
    await rm(path.join(data, 'maps/pool_party.json'));
    await mergeBundledDefaults(data, bundled);
    expect(await kindIds()).toEqual(['a', 'b']);
    expect(await readdir(path.join(data, 'maps'))).toEqual(['old.json']);
  });

  it('records the ledger for a data dir that already holds every bundled default', async () => {
    await put(data, 'world-object-kinds.json', catalog('a', 'b', 'pool'));
    await put(data, 'maps/old.json', 'x');
    await put(data, 'maps/pool_party.json', 'x');
    await put(data, 'rooms/pool-party.json', 'x');
    await mergeBundledDefaults(data, bundled);
    const ledger = JSON.parse(await readFile(path.join(data, LEDGER_FILE), 'utf8'));
    expect(ledger.kinds).toEqual(['a', 'b', 'pool']);
    expect(ledger.files.maps).toEqual(['old.json', 'pool_party.json']);
  });

  it('is a no-op on a second run', async () => {
    await put(data, 'world-object-kinds.json', catalog('a'));
    await mergeBundledDefaults(data, bundled);
    const catalogAfter = await readFile(path.join(data, 'world-object-kinds.json'), 'utf8');
    const ledgerAfter = await readFile(path.join(data, LEDGER_FILE), 'utf8');
    await mergeBundledDefaults(data, bundled);
    expect(await readFile(path.join(data, 'world-object-kinds.json'), 'utf8')).toBe(catalogAfter);
    expect(await readFile(path.join(data, LEDGER_FILE), 'utf8')).toBe(ledgerAfter);
  });

  it('leaves an unreadable catalog alone and retries its kinds next run', async () => {
    await put(data, 'world-object-kinds.json', '{broken');
    await mergeBundledDefaults(data, bundled);
    expect(await readFile(path.join(data, 'world-object-kinds.json'), 'utf8')).toBe('{broken');
    expect(JSON.parse(await readFile(path.join(data, LEDGER_FILE), 'utf8')).kinds).toEqual([]);
  });
});
