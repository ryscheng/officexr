import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { studioMapExists, studioMapLoader } from '../../vite-plugin-storage.ts';

const dataDir = mkdtempSync(path.join(tmpdir(), 'officexr-maps-'));
mkdirSync(path.join(dataDir, 'maps'));
copyFileSync(path.resolve(__dirname, '../../maps/default.json'), path.join(dataDir, 'maps', 'good.json'));
writeFileSync(path.join(dataDir, 'maps', 'broken.json'), '{}');
writeFileSync(path.join(dataDir, 'secret.json'), '{}');

describe('studioMapExists', () => {
  const exists = studioMapExists(dataDir);

  it('accepts a map file that parses as a map', async () => {
    expect(await exists('good')).toBe(true);
  });

  it('rejects missing and unparseable maps', async () => {
    expect(await exists('missing')).toBe(false);
    expect(await exists('broken')).toBe(false);
  });

  it('rejects names that are not plain slugs', async () => {
    expect(await exists('../secret')).toBe(false);
    expect(await exists('a/b')).toBe(false);
    expect(await exists('..')).toBe(false);
  });

  it('defaults to the bundled maps', async () => {
    expect(await studioMapExists()('default')).toBe(true);
  });
});

describe('studioMapLoader', () => {
  const load = studioMapLoader(dataDir);

  it('returns the parsed map, or null when it is missing, broken or not a slug', async () => {
    expect((await load('good'))?.name).toBe(JSON.parse(readFileSync(path.resolve(__dirname, '../../maps/default.json'), 'utf8')).name);
    expect(await load('missing')).toBeNull();
    expect(await load('broken')).toBeNull();
    expect(await load('../secret')).toBeNull();
  });
});
