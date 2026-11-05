import type { SoundCatalog } from '@officexr/world/app';
import { paths, studioApiUrl, studioFetch } from '../../apiOrigin.ts';

export interface SoundLibraryStorage {
  list(): Promise<SoundCatalog>;
  put(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  remove(name: string): Promise<void>;
  /** URL an `<audio>` element can play. */
  url(name: string): string;
}

const soundUrl = (name: string) => studioApiUrl(`${paths.sounds}/${encodeURIComponent(name)}.mp3`);

async function assertOk(res: Response): Promise<void> {
  if (!res.ok) {
    throw new Error((await res.text().catch(() => '')) || `${res.status} ${res.statusText}`);
  }
}

export class HttpSoundLibraryStorage implements SoundLibraryStorage {
  async list(): Promise<SoundCatalog> {
    const res = await studioFetch(studioApiUrl(`${paths.sounds}/`));
    await assertOk(res);
    return res.json();
  }

  async put(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    await assertOk(await studioFetch(soundUrl(name), { method: 'PUT', body: bytes }));
  }

  async remove(name: string): Promise<void> {
    await assertOk(await studioFetch(soundUrl(name), { method: 'DELETE' }));
  }

  url = soundUrl;
}

export class InMemorySoundLibraryStorage implements SoundLibraryStorage {
  private readonly sounds = new Map<string, { bytes: Uint8Array<ArrayBuffer>; updatedAt: number; objectUrl?: string }>();

  constructor(opts: { seed?: Array<{ name: string; bytes: number[] }> } = {}) {
    for (const { name, bytes } of opts.seed ?? []) {
      this.sounds.set(name, { bytes: Uint8Array.from(bytes), updatedAt: Date.now() });
    }
  }

  async list(): Promise<SoundCatalog> {
    return {
      sounds: [...this.sounds].map(([name, s]) => ({ name, size: s.bytes.length, updatedAt: s.updatedAt })),
    };
  }

  async put(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    this.release(name);
    this.sounds.set(name, { bytes, updatedAt: Date.now() });
  }

  async remove(name: string): Promise<void> {
    this.release(name);
    this.sounds.delete(name);
  }

  url(name: string): string {
    const sound = this.sounds.get(name);
    if (!sound) {
      return '';
    }
    sound.objectUrl ??= URL.createObjectURL(new Blob([sound.bytes], { type: 'audio/mpeg' }));
    return sound.objectUrl;
  }

  private release(name: string) {
    const objectUrl = this.sounds.get(name)?.objectUrl;
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
