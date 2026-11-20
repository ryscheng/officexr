import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeployment, highestMigration, pgAppliedVersion } from './deployment';

afterEach(() => vi.useRealTimers());

describe('highestMigration', () => {
  it('takes the highest numeric prefix and ignores other files', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'migrations-'));
    try {
      for (const name of ['001_a.sql', '026_b.sql', '009_c.sql', 'README.md', 'x_027.sql']) {
        writeFileSync(path.join(dir, name), '');
      }
      expect(highestMigration(dir)).toBe('026');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe('pgAppliedVersion', () => {
  it('returns the highest recorded version', async () => {
    const query = async () => ({ rows: [{ version: '002' }, { version: '026' }, { version: '010' }] });
    expect(await pgAppliedVersion(query)).toBe('026');
  });

  it('treats a missing table as nothing applied', async () => {
    const query = async () => {
      throw Object.assign(new Error('missing'), { code: '42P01' });
    };
    expect(await pgAppliedVersion(query)).toBeUndefined();
  });

  it('rethrows other errors', async () => {
    const query = async () => {
      throw new Error('down');
    };
    await expect(pgAppliedVersion(query)).rejects.toThrow('down');
  });
});

describe('createDeployment', () => {
  const make = (applied: () => Promise<string | undefined>, extra: object = {}) =>
    createDeployment({ commit: 'abc', builtAt: 'T', expected: '026', applied, ...extra });

  it('is ready when applied reaches expected', async () => {
    const d = make(async () => '026');
    expect(await d.readiness?.()).toEqual({ ok: true });
    expect(await d.version?.()).toEqual({ builtAt: 'T', db: { expected: '026', applied: '026', ok: true } });
  });

  it('reports schema-behind when applied is lower or absent', async () => {
    expect(await make(async () => '025').readiness?.()).toEqual({ ok: false, reason: 'schema-behind' });
    expect(await make(async () => undefined).readiness?.()).toEqual({ ok: false, reason: 'schema-behind' });
  });

  it('reports db-unreachable on error without leaking it', async () => {
    const d = make(async () => {
      throw new Error('postgres://user:secret@host/db');
    });
    expect(await d.readiness?.()).toEqual({ ok: false, reason: 'db-unreachable' });
    const version = JSON.stringify(await d.version?.());
    expect(version).not.toContain('secret');
    expect(await d.version?.()).toMatchObject({ db: { applied: null, ok: false } });
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    const d = make(() => new Promise(() => {}), { timeoutMs: 1000 });
    const pending = d.readiness?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toEqual({ ok: false, reason: 'db-unreachable' });
  });

  it('caches for the ttl and reloads after it', async () => {
    let clock = 0;
    const applied = vi.fn(async () => '026');
    const d = make(applied, { ttlMs: 60_000, now: () => clock });
    await d.readiness?.();
    await d.version?.();
    expect(applied).toHaveBeenCalledTimes(1);
    clock = 60_001;
    await d.readiness?.();
    expect(applied).toHaveBeenCalledTimes(2);
  });
});
