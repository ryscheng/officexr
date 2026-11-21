import { CHARACTERS, characterUrl, type CharacterName } from './registry.ts';

// One literal `new URL` per file: the bundler only emits an asset it can see in the source.
const PORTRAIT_FILES: Record<CharacterName, string> = {
  Barbarian: new URL('./portraits/Barbarian.webp', import.meta.url).href,
  Knight: new URL('./portraits/Knight.webp', import.meta.url).href,
  Mage: new URL('./portraits/Mage.webp', import.meta.url).href,
  Ranger: new URL('./portraits/Ranger.webp', import.meta.url).href,
  Rogue: new URL('./portraits/Rogue.webp', import.meta.url).href,
  Rogue_Hooded: new URL('./portraits/Rogue_Hooded.webp', import.meta.url).href,
};

/** The pre-rendered portrait of a built-in character's model URL, or `null` for any other URL. */
export function basePortrait(url: string): string | null {
  const name = CHARACTERS.find((character) => characterUrl(character) === url);
  return name ? PORTRAIT_FILES[name] : null;
}
