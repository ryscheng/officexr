import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';

export const LEDGER_FILE = '.seeded-bundle.json';

const CATALOG_FILE = 'world-object-kinds.json';
const SEEDED_DIRS = ['rooms', 'maps', 'layouts', 'baked-layouts', 'sounds', 'scenes'];

interface Ledger {
  kinds: string[];
  files: Record<string, string[]>;
}

interface Catalog {
  updatedAt?: number;
  kinds: Array<{ id: string }>;
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function readLedger(dataDir: string): Promise<Ledger> {
  const raw = await readJson<Partial<Ledger>>(path.join(dataDir, LEDGER_FILE));
  return { kinds: raw?.kinds ?? [], files: raw?.files ?? {} };
}

async function listNames(dir: string): Promise<string[]> {
  return fs.readdir(dir).catch(() => []);
}

async function mergeKinds(dataDir: string, bundledDir: string, ledger: Ledger): Promise<void> {
  const bundled = await readJson<Catalog>(path.join(bundledDir, CATALOG_FILE));
  const file = path.join(dataDir, CATALOG_FILE);
  const current = await readJson<Catalog>(file);
  if (!bundled || !current || !Array.isArray(bundled.kinds) || !Array.isArray(current.kinds)) {
    return;
  }
  const offered = new Set(ledger.kinds);
  const present = new Set(current.kinds.map((k) => k.id));
  const added = bundled.kinds.filter((k) => !offered.has(k.id) && !present.has(k.id));
  if (added.length > 0) {
    await writeFileAtomic(file, JSON.stringify({ ...current, updatedAt: Date.now(), kinds: [...current.kinds, ...added] }));
  }
  ledger.kinds = [...new Set([...ledger.kinds, ...bundled.kinds.map((k) => k.id)])];
}

async function mergeFiles(dataDir: string, bundledDir: string, ledger: Ledger): Promise<void> {
  for (const name of SEEDED_DIRS) {
    const offered = new Set(ledger.files[name] ?? []);
    const bundled = await listNames(path.join(bundledDir, name));
    for (const entry of bundled) {
      const dst = path.join(dataDir, name, entry);
      if (!offered.has(entry) && !(await exists(dst))) {
        await fs.mkdir(path.join(dataDir, name), { recursive: true });
        await fs.cp(path.join(bundledDir, name, entry), dst, { recursive: true, force: false, errorOnExist: false });
      }
    }
    if (bundled.length > 0) {
      ledger.files[name] = [...new Set([...offered, ...bundled])];
    }
  }
}

/**
 * Adds bundled kinds and files the data dir was never offered, so a data dir seeded by an older
 * build still gets new defaults. `LEDGER_FILE` records what was offered; a kind or file a person
 * deleted after that stays deleted, and one that exists is never overwritten. A data dir with no
 * ledger counts as having been offered nothing.
 */
export async function mergeBundledDefaults(dataDir: string, bundledDir: string): Promise<void> {
  const before = await readLedger(dataDir);
  const ledger: Ledger = { kinds: [...before.kinds], files: { ...before.files } };
  await mergeKinds(dataDir, bundledDir, ledger);
  await mergeFiles(dataDir, bundledDir, ledger);
  if (JSON.stringify(ledger) !== JSON.stringify(before) || !(await exists(path.join(dataDir, LEDGER_FILE)))) {
    await writeFileAtomic(path.join(dataDir, LEDGER_FILE), JSON.stringify(ledger, null, 2) + '\n');
  }
}
