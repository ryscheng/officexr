import { describe, expect, it } from 'vitest';
import { createSpriteSource, SpriteImages, type SpriteManifest } from './sprites.ts';

const frame = (yawDeg: number) => ({ yawDeg, x: yawDeg, y: 0, w: 10, h: 10, ax: 1, ay: 2 });
const sheet = (url: string) => ({ url, cell: { w: 4, h: 8 }, anchor: { x: 2, y: 7 }, directions: ['down', 'left', 'right', 'up'], columns: { idle: 0, walk: [1, 8] as const, sit: 9 } });

const manifest: SpriteManifest = {
  kindPpm: 96,
  characterPpm: 128,
  elevation: 0.6,
  characterElevation: 0.82,
  kinds: { desk: { url: 'desk.webp', frames: [0, 90, 180, 270].map(frame) } },
  characters: { Knight: sheet('knight.webp'), Rogue: sheet('rogue.webp') },
};

/** Images that are "decoded" once their URL is in `ready`. */
class FakeImages extends SpriteImages {
  readonly asked: string[] = [];
  constructor(private readonly ready: Set<string>) {
    super();
  }
  override get(url: string) {
    this.asked.push(url);
    return this.ready.has(url) ? ({ url } as unknown as CanvasImageSource) : null;
  }
}

describe('createSpriteSource', () => {
  it('serves the frame for an instance yaw, rounded to a quarter turn', () => {
    const sprites = createSpriteSource(manifest, new FakeImages(new Set(['desk.webp'])));
    expect(sprites.kind('desk', 90)?.frame.yawDeg).toBe(90);
    expect(sprites.kind('desk', -90)?.frame.yawDeg).toBe(270);
    expect(sprites.kind('desk', 359)?.frame.yawDeg).toBe(0);
    expect(sprites.kind('desk', 0)?.ppm).toBe(96);
  });

  it('answers null for a kind with no sprite, or one still decoding', () => {
    const images = new FakeImages(new Set());
    const sprites = createSpriteSource(manifest, images);
    expect(sprites.kind('unknown', 0)).toBeNull();
    expect(sprites.kind('desk', 0)).toBeNull();
    expect(images.asked).toEqual(['desk.webp']);
  });

  it('uses the player’s own sheet, else a built-in chosen by login so every window agrees', () => {
    const sprites = createSpriteSource(manifest, new FakeImages(new Set(['knight.webp', 'rogue.webp'])));
    expect(sprites.character('Knight', 'ana@x.co#1')?.sheet.url).toBe('knight.webp');
    const fallback = sprites.character('default', 'ana@x.co#1')?.sheet.url;
    expect(['knight.webp', 'rogue.webp']).toContain(fallback);
    expect(sprites.character('default', 'ana@x.co#2')?.sheet.url).toBe(fallback);
  });
});
