import type { MapDocumentV1 } from '@officexr/world/scenes';
import { describe, expect, it, vi } from 'vitest';
import { withDefaultMap } from './withDefaultMap';

const fakeMaps = (existing: string[]) => ({
  load: async (name: string) => (existing.includes(name) ? ({ name } as unknown as MapDocumentV1) : null),
});

const loadedName = async (existing: string[], name: string) =>
  (await withDefaultMap(fakeMaps(existing)).load(name)) as { name: string } | null;

describe('withDefaultMap', () => {
  it('loads the requested map when it exists', async () => {
    expect((await loadedName(['default', 'hq'], 'hq'))?.name).toBe('hq');
  });

  it('falls back to the default map with a warning when the map is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await loadedName(['default'], 'gone'))?.name).toBe('default');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('returns null after one warning when the default map is missing too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadedName([], 'gone')).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('rethrows other load errors', async () => {
    const maps = {
      load: async (): Promise<MapDocumentV1 | null> => {
        throw new Error('network down');
      },
    };
    await expect(withDefaultMap(maps).load('hq')).rejects.toThrow('network down');
  });
});
