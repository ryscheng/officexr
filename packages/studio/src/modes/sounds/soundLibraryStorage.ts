import { soundCatalogSchema, type SoundCatalog } from '@officexr/world/app';
import { httpError } from '@officexr/world/scenes';

export interface SoundLibraryStorage {
  list(): Promise<SoundCatalog>;
  put(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  remove(name: string): Promise<void>;
  /** URL an `<audio>` element can play. */
  url(name: string): string;
}

export class HttpSoundLibraryStorage implements SoundLibraryStorage {
  private readonly base: string;
  private readonly fetch: typeof fetch;

  constructor(opts: { basePath: string; fetch: typeof fetch }) {
    this.base = opts.basePath.replace(/\/$/, '');
    this.fetch = opts.fetch;
  }

  async list(): Promise<SoundCatalog> {
    const res = await this.fetch(`${this.base}/`);
    if (!res.ok) {
      throw await httpError('list sounds', res);
    }
    return soundCatalogSchema.parse(await res.json());
  }

  async put(name: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const res = await this.fetch(this.url(name), { method: 'PUT', body: bytes });
    if (!res.ok) {
      throw await httpError(`save ${name}`, res);
    }
  }

  async remove(name: string): Promise<void> {
    const res = await this.fetch(this.url(name), { method: 'DELETE' });
    if (!res.ok) {
      throw await httpError(`delete ${name}`, res);
    }
  }

  url(name: string): string {
    return `${this.base}/${encodeURIComponent(name)}.mp3`;
  }
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
