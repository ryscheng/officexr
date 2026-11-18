import { loginOf, type PlayerId } from '@officexr/sdk';
import { hashString } from './topDownScene.ts';

export type Facing = 'down' | 'up' | 'left' | 'right';

/** One yaw of a kind's sprite strip; `(ax, ay)` is the pixel of the footprint's min-x/min-z corner at the model's base. */
export interface KindSpriteFrame {
  yawDeg: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
}

export interface KindSprite {
  url: string;
  frames: readonly KindSpriteFrame[];
}

/** A character sheet: a row per facing; columns idle, the walk cycle, seated. Cells share one size and anchor on the feet. */
export interface CharacterSheet {
  url: string;
  cell: { w: number; h: number };
  anchor: { x: number; y: number };
  directions: readonly string[];
  columns: { idle: number; walk: readonly [start: number, count: number]; sit: number };
}

/** What `scripts/bake-sprites.ts` writes to `spriteManifest.ts`. */
export interface SpriteManifest {
  /** Sprite pixels per world metre. */
  kindPpm: number;
  characterPpm: number;
  /** The oblique projection the kinds were baked with; must equal `ELEVATION` for footprints to line up. */
  elevation: number;
  characterElevation: number;
  kinds: Readonly<Record<string, KindSprite>>;
  characters: Readonly<Record<string, CharacterSheet>>;
}

export interface KindSpriteDraw {
  image: CanvasImageSource;
  frame: KindSpriteFrame;
  ppm: number;
}

export interface CharacterSpriteDraw {
  image: CanvasImageSource;
  sheet: CharacterSheet;
  ppm: number;
  elevation: number;
}

/** Where the 2D view gets art; null means "not available (yet)", and the caller falls back to a painter. */
export interface SpriteSource {
  kind(kindId: string, yawDeg: number): KindSpriteDraw | null;
  character(model: string, playerId: PlayerId): CharacterSpriteDraw | null;
}

export const NO_SPRITES: SpriteSource = { kind: () => null, character: () => null };

/** Decodes images on first request and answers null until they are ready, so a frame never waits on the network. */
export class SpriteImages {
  private readonly images = new Map<string, HTMLImageElement>();

  get(url: string): CanvasImageSource | null {
    if (typeof Image === 'undefined') {
      return null;
    }
    let img = this.images.get(url);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = url;
      this.images.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
}

const normalYaw = (yawDeg: number) => ((Math.round(yawDeg / 90) * 90) % 360 + 360) % 360;

/**
 * Serves a manifest's sprites. A player whose model has no sheet (a 2D-only avatar, a catalog
 * character) still gets a built-in one, chosen from their login so every window agrees.
 */
export function createSpriteSource(manifest: SpriteManifest, images: SpriteImages = new SpriteImages()): SpriteSource {
  const characterNames = Object.keys(manifest.characters).sort();
  return {
    kind(kindId, yawDeg) {
      const sprite = manifest.kinds[kindId];
      const frame = sprite?.frames.find((f) => f.yawDeg === normalYaw(yawDeg));
      const image = sprite && frame ? images.get(sprite.url) : null;
      return image && frame ? { image, frame, ppm: manifest.kindPpm } : null;
    },
    character(model, playerId) {
      const name = manifest.characters[model] ? model : characterNames[hashString(loginOf(playerId)) % Math.max(characterNames.length, 1)];
      const sheet = name ? manifest.characters[name] : undefined;
      const image = sheet ? images.get(sheet.url) : null;
      return image && sheet ? { image, sheet, ppm: manifest.characterPpm, elevation: manifest.characterElevation } : null;
    },
  };
}
