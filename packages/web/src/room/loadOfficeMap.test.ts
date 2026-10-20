import { MapNotFoundError } from '@officexr/world/app';
import { describe, expect, it, vi } from 'vitest';
import { loadOfficeMap } from './loadOfficeMap';

const fakeLoad = (existing: string[]) => async (name: string) => {
  if (!existing.includes(name)) {
    throw new MapNotFoundError(name);
  }
  return name;
};

describe('loadOfficeMap', () => {
  it('loads the office map when it exists', async () => {
    expect(await loadOfficeMap(fakeLoad(['default', 'hq']), 'hq')).toBe('hq');
  });

  it('loads the default map when the office has none', async () => {
    expect(await loadOfficeMap(fakeLoad(['default']), null)).toBe('default');
  });

  it('falls back to the default map with a warning when the office map is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadOfficeMap(fakeLoad(['default']), 'gone')).toBe('default');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('rethrows other load errors', async () => {
    const load = async () => {
      throw new Error('network down');
    };
    await expect(loadOfficeMap(load, 'hq')).rejects.toThrow('network down');
  });
});
