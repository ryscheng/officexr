// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledModelPacks } from './studio-backend.ts';

describe('bundledModelPacks', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'packs-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('lists only top-level directories', async () => {
    await mkdir(path.join(dir, 'Furniture', 'nested'), { recursive: true });
    await mkdir(path.join(dir, 'Prototype'));
    await writeFile(path.join(dir, 'loose.glb'), '');
    expect(await bundledModelPacks(dir)).toEqual(new Set(['Furniture', 'Prototype']));
  });
});
