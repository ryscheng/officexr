import type { WorldObjectKind } from '../scenes/world-object-kinds-schema.ts';

/**
 * What a placed object reads as in the 2D view. Each archetype has one painter in
 * `ARCHETYPE_STYLES`; adding one here fails the build until it has a painter.
 */
export const ARCHETYPES = [
  'floor',
  'wall',
  'rug',
  'desk',
  'table',
  'chair',
  'sofa',
  'bed',
  'plant',
  'shelf',
  'storage',
  'lamp',
  'screen',
  'decor',
  'block',
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

export type ArchetypeKind = Pick<WorldObjectKind, 'id' | 'label' | 'category' | 'isLayoutObject' | 'isDesk' | 'seat'>;

/** World-aligned extents in metres. */
export interface ArchetypeSize {
  width: number;
  depth: number;
  height: number;
}

/** Below this a layout object is a floor rather than a wall. */
const FLOOR_MAX_HEIGHT_M = 0.3;
/** Below this anything else lies flat on the floor. */
const FLAT_MAX_HEIGHT_M = 0.12;
/** A seat at least this wide holds more than one person. */
const SOFA_MIN_WIDTH_M = 1.4;
/** A desk-flagged top this small is a side table, not a workstation. */
const DESK_MIN_SPAN_M = 0.9;

/**
 * First match wins, so specific words come before the generic ones they contain
 * ("armchair" before "chair", "bookshelf" before "book"). Matched against the
 * kind's label and id, lowercased with separators turned into spaces.
 */
const KEYWORD_RULES: readonly { archetype: Archetype; pattern: RegExp }[] = [
  { archetype: 'rug', pattern: /\b(rug|carpet|mat)\b/ },
  { archetype: 'plant', pattern: /\b(plant|cactus|tree|bush|flower|fern|potted|bamboo|palm|succulent)/ },
  { archetype: 'sofa', pattern: /\b(couch|sofa|armchair|bench|beanbag|pouf|ottoman)/ },
  { archetype: 'chair', pattern: /\b(chair|stool|seat)/ },
  { archetype: 'bed', pattern: /\bbed\b/ },
  { archetype: 'screen', pattern: /\b(monitor|computer|laptop|tv|television|screen|display|pc|keyboard)\b/ },
  { archetype: 'shelf', pattern: /\b(shelf|shelves|bookcase|bookshelf)/ },
  { archetype: 'desk', pattern: /\b(desk|workstation)/ },
  { archetype: 'table', pattern: /\b(table|counter|bar)\b/ },
  { archetype: 'storage', pattern: /\b(cabinet|drawer|cupboard|fridge|refrigerator|locker|crate|dresser|wardrobe|oven|stove|sink|printer|vending)/ },
  { archetype: 'lamp', pattern: /\b(lamp|light|lantern|candle)/ },
  { archetype: 'decor', pattern: /\b(picture|pictureframe|frame|pillow|painting|clock|vase|cup|mug|plate|bottle|book|food|bowl|glass|statue|trophy)/ },
  { archetype: 'wall', pattern: /\b(wall|pillar|column|window|fence|railing)/ },
  { archetype: 'floor', pattern: /\b(floor|tile|ground)\b/ },
];

/** `furniture_chair_a` / "Chair A" → "furniture chair a chair a", for whole-word matching. */
function searchText(kind: ArchetypeKind): string {
  return `${kind.label} ${kind.id}`
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-./]+/g, ' ')
    .toLowerCase();
}

/**
 * How the 2D view draws a kind. Structure (layout objects) goes by height alone; furniture
 * by the kind's own flags (`isDesk`, `seat`), then its name, then its shape.
 */
export function classifyKind(kind: ArchetypeKind, size: ArchetypeSize): Archetype {
  if (kind.isLayoutObject) {
    return size.height < FLOOR_MAX_HEIGHT_M ? 'floor' : 'wall';
  }
  if (kind.seat) {
    return Math.max(size.width, size.depth) >= SOFA_MIN_WIDTH_M ? 'sofa' : 'chair';
  }
  if (kind.isDesk) {
    return Math.max(size.width, size.depth) >= DESK_MIN_SPAN_M ? 'desk' : 'table';
  }
  const text = searchText(kind);
  const rule = KEYWORD_RULES.find((r) => r.pattern.test(text));
  if (rule) {
    return rule.archetype;
  }
  if (size.height < FLAT_MAX_HEIGHT_M) {
    return 'rug';
  }
  return 'block';
}

/** Wood-toned variants of chairs and tables, named so in the catalog. */
export function isWooden(kind: Pick<ArchetypeKind, 'id' | 'label'>): boolean {
  return /wood/i.test(`${kind.label} ${kind.id}`);
}
