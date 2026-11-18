import { PALETTE, SPRITE_MANIFEST, hashString, type CharacterSheet, type KindSprite } from '@officexr/world/top-down';

/** Thumbnail units per metre: the card shows a 26 × 14 m slice of office. */
const U = 6;
const W = 26 * U;
const H = 14 * U;

/** mulberry32: a tiny seeded generator, so an office always gets the same picture. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One frame of a baked kind strip, its footprint corner at (x, z) metres, cropped with a nested viewBox. */
function Kind({ id, x, z, yaw = 0 }: { id: string; x: number; z: number; yaw?: number }) {
  const sprite: KindSprite | undefined = SPRITE_MANIFEST.kinds[id];
  const f = sprite?.frames.find((frame) => frame.yawDeg === yaw);
  if (!sprite || !f) {
    return null;
  }
  const s = U / SPRITE_MANIFEST.kindPpm;
  const sheetW = Math.max(...sprite.frames.map((frame) => frame.x + frame.w));
  const sheetH = Math.max(...sprite.frames.map((frame) => frame.h));
  return (
    <svg x={x * U - f.ax * s} y={z * U - f.ay * s} width={f.w * s} height={f.h * s} viewBox={`${f.x} ${f.y} ${f.w} ${f.h}`}>
      <image href={sprite.url} width={sheetW} height={sheetH} />
    </svg>
  );
}

/** A baked character standing idle, facing the viewer, feet at (x, z) metres. */
function Person({ name, x, z }: { name: string; x: number; z: number }) {
  const sheet: CharacterSheet | undefined = SPRITE_MANIFEST.characters[name];
  if (!sheet) {
    return null;
  }
  const s = (U / SPRITE_MANIFEST.characterPpm) * 1.1;
  const columns = sheet.columns.sit + 1;
  return (
    <svg
      x={x * U - sheet.anchor.x * s}
      y={z * U - sheet.anchor.y * s}
      width={sheet.cell.w * s}
      height={sheet.cell.h * s}
      viewBox={`${sheet.columns.idle * sheet.cell.w} 0 ${sheet.cell.w} ${sheet.cell.h}`}
    >
      <image href={sheet.url} width={sheet.cell.w * columns} height={sheet.cell.h * sheet.directions.length} />
    </svg>
  );
}

/** A desk with a chair on each side of each end, as in the office's pods. */
function Pod({ x, z }: { x: number; z: number }) {
  return (
    <>
      <Kind id="furniture_chair_c" x={x + 0.4} z={z - 0.95} />
      <Kind id="furniture_chair_c" x={x + 1.85} z={z - 0.95} />
      <Kind id="furniture_table_medium_long" x={x} z={z} />
      <Kind id="furniture_chair_c" x={x + 0.4} z={z + 2.05} yaw={180} />
      <Kind id="furniture_chair_c" x={x + 1.85} z={z + 2.05} yaw={180} />
    </>
  );
}

/**
 * A slice of office drawn with the 2D view's own baked sprites: desk pods, a lounge or a meeting
 * table, plants and a few people. Decorative, and stable per office so each card is recognisable.
 */
export function OfficeThumbnail({ seed, className = '' }: { seed: string; className?: string }) {
  const rand = random(hashString(seed));
  const characters = Object.keys(SPRITE_MANIFEST.characters);
  const pick = () => characters[Math.floor(rand() * characters.length)];
  const pods = 2 + Math.floor(rand() * 2);
  const lounge = rand() > 0.5;
  const people = [
    { name: pick(), x: 3.2 + rand() * 6, z: 7.8 },
    { name: pick(), x: 11 + rand() * 4, z: 12.2 },
    { name: pick(), x: 19.5 + rand() * 3, z: lounge ? 11.6 : 12.4 },
  ];
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width={W} height={H} fill={PALETTE.planks} />
      {Array.from({ length: Math.ceil(H / (U / 2)) }, (_, i) => (
        <line key={i} x1={0} x2={W} y1={(i * U) / 2 + 0.25} y2={(i * U) / 2 + 0.25} stroke={PALETTE.plankLine} strokeWidth={0.4} />
      ))}
      <rect width={W} height={U * 0.9} fill={PALETTE.wallFront} />
      <rect width={W} height={U * 0.25} fill={PALETTE.wallTop} />
      <Kind id="furniture_shelf_b_large_decorated" x={12.5} z={0.2} />
      <Kind id="furniture_cactus_medium_a" x={0.4} z={0.4} />
      {lounge ? (
        <>
          <Kind id="furniture_rug_rectangle_stripes_a" x={18.5} z={6.5} />
          <Kind id="furniture_couch_pillows" x={19} z={4.6} />
          <Kind id="furniture_table_low" x={19.3} z={7.4} />
        </>
      ) : (
        <>
          <Kind id="restaurant_chair_a" x={20.6} z={4.2} />
          <Kind id="restaurant_table_round_a" x={19.5} z={5.3} />
          <Kind id="restaurant_chair_a" x={20.6} z={8.6} yaw={180} />
        </>
      )}
      {Array.from({ length: pods }, (_, i) => (
        <Pod key={i} x={1 + i * 4.6} z={3} />
      ))}
      <Kind id="furniture_lamp_standing" x={24.4} z={1} />
      <Kind id="furniture_cactus_small_a" x={24.8} z={12.6} />
      {people
        .sort((a, b) => a.z - b.z)
        .map((p, i) => (
          <Person key={i} name={p.name} x={p.x} z={p.z} />
        ))}
    </svg>
  );
}
