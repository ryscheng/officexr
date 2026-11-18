/**
 * The 2D view's colours: a warm, lit office on a mint lawn, with HUD-navy name tags so the
 * canvas and the DOM overlays read as one product. Kept apart from the painters so a
 * re-theme touches one file.
 */
export const PALETTE = {
  lawn: '#d5ebcf',
  lawnLine: '#c8e2c1',
  /** Floors outside the building footprint: paving. */
  paving: '#ebe6dc',
  pavingLine: '#ddd6c9',
  /** The walkable office: warm planks. */
  planks: '#f1e4d1',
  plankLine: '#e4d3bc',
  plankSeam: '#dcc9af',
  footprintEdge: 'rgba(84, 62, 38, 0.28)',
  shadow: 'rgba(30, 36, 51, 0.16)',

  /** Gather-style walls: a dark cap line over a light wall face with a baseboard. */
  wallTop: '#6f7789',
  wallFront: '#ded9cf',
  wallBase: '#bdb4a6',
  wallHighlight: '#8a92a3',

  deskTop: '#fbfbfd',
  deskEdge: '#d9dee7',
  deskFront: '#b8c1cf',
  monitorFrame: '#262c3a',
  monitorScreen: '#5b8def',
  monitorGlow: '#9cc0ff',
  monitorBack: '#3a4253',
  keyboard: '#dfe3ea',

  woodTop: '#d9a877',
  woodFront: '#b07a4b',
  woodHighlight: '#e6bd92',

  chairSeat: '#56627a',
  chairBack: '#3d4659',
  chairFront: '#2f3747',

  sofaTop: '#eaa56b',
  sofaFront: '#c47f45',
  sofaBack: '#d68f55',
  sofaSeam: '#d99358',

  bedFrame: '#b07a4b',
  bedSheet: '#f7f4ee',
  bedBlanket: '#7fa7d9',

  potTop: '#cf7a52',
  potFront: '#a65a38',
  leafDark: '#3f8f4c',
  leafLight: '#5cb26a',
  leafHighlight: '#8fd38f',

  shelfTop: '#8b5e3c',
  shelfFront: '#6d4529',
  shelfBoard: '#5a3820',

  storageTop: '#d5dbe4',
  storageFront: '#a8b2c1',
  storageLine: '#8b96a8',

  lampShade: '#fde7a5',
  lampGlow: 'rgba(253, 224, 140, 0.35)',
  lampBase: '#5e667a',

  screenTop: '#2a3142',
  screenFront: '#1d2230',

  blockTop: '#ddd0b8',
  blockFront: '#bba98a',

  /** Name tags and labels share the HUD's liquid-glass colours. */
  tag: 'rgba(255, 255, 255, 0.92)',
  tagText: '#1d1d1f',
  tagSelf: '#007aff',
  tagSelfText: '#ffffff',
  tagShadow: 'rgba(15, 23, 42, 0.22)',
  zoneLabel: 'rgba(255, 255, 255, 0.86)',
  zoneLabelText: 'rgba(60, 60, 67, 0.8)',
  available: '#34c759',
  away: '#ff9f0a',
  speaking: '#4ade80',
  accent: '#007aff',
  accentDeep: '#0066d6',
  destination: '#007aff',
} as const;

/** Rug colours, picked per instance. */
export const RUG_COLOURS = ['#a9c6ea', '#f3c6a3', '#cbb8e6', '#b6dec8', '#f2b8c6'] as const;
/** Voice-zone floor tints, picked per zone (Gather-style team areas). */
export const ZONE_TINTS = [
  'rgba(129, 140, 248, 0.20)',
  'rgba(52, 211, 153, 0.18)',
  'rgba(56, 189, 248, 0.18)',
  'rgba(251, 146, 160, 0.18)',
  'rgba(250, 204, 21, 0.18)',
] as const;
export const ZONE_EDGES = [
  'rgba(99, 102, 241, 0.45)',
  'rgba(16, 185, 129, 0.45)',
  'rgba(14, 165, 233, 0.45)',
  'rgba(244, 63, 94, 0.40)',
  'rgba(202, 138, 4, 0.45)',
] as const;
export const BOOK_COLOURS = ['#e76f51', '#2a9d8f', '#e9c46a', '#577590', '#f4a261', '#9b5de5', '#f8f9fa'] as const;
export const DECOR_COLOURS = ['#f4a261', '#90be6d', '#43aa8b', '#f9c74f', '#577590', '#f28482'] as const;

/** Characters: one of each per person, chosen from their login so every window agrees. */
export const SKIN_TONES = ['#f7d7c4', '#eebb99', '#d9a07b', '#b57a55', '#8a5a3b', '#5e3d2a'] as const;
export const HAIR_COLOURS = ['#2b2118', '#4a3123', '#7a4b2a', '#c58b4b', '#e2c27a', '#1f2a44', '#8c2f39', '#d9d4cc'] as const;
export const SHIRT_COLOURS = ['#5b8def', '#ef6f6c', '#45b37f', '#f2a541', '#9b6bdf', '#2bb5b5', '#e86aa6', '#4c566a'] as const;
export const PANTS_COLOURS = ['#2f3747', '#3b4a6b', '#4a3b30', '#2d3a32'] as const;
