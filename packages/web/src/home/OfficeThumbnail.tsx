/** The few colours the picture uses: a warm office floor, white desks, wood, plants. */
const PALETTE = {
  planks: '#f1e4d1',
  plankLine: '#e4d3bc',
  wallTop: '#6f7789',
  wallFront: '#ded9cf',
  deskTop: '#fbfbfd',
  deskFront: '#b8c1cf',
  monitorScreen: '#5b8def',
  chairSeat: '#56627a',
  woodTop: '#d9a877',
  woodFront: '#b07a4b',
  sofaTop: '#eaa56b',
  sofaFront: '#c47f45',
  potTop: '#cf7a52',
  leafDark: '#3f8f4c',
  leafLight: '#5cb26a',
  shadow: 'rgba(30, 36, 51, 0.16)',
} as const;
const RUG_COLOURS = ['#a9c6ea', '#f3c6a3', '#cbb8e6', '#b6dec8', '#f2b8c6'] as const;
const SHIRT_COLOURS = ['#5b8def', '#ef6f6c', '#45b37f', '#f2a541', '#9b6bdf', '#2bb5b5', '#e86aa6', '#4c566a'] as const;

/** FNV-1a, so an office keeps its picture across reloads. */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const W = 160;
const H = 84;

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

function DeskPod({ x, y }: { x: number; y: number }) {
  return (
    <g>
      {[x + 4, x + 14].map((cx) => (
        <rect key={cx} x={cx} y={y - 5} width={6} height={4} rx={1.5} fill={PALETTE.chairSeat} />
      ))}
      <rect x={x} y={y} width={24} height={10} rx={1.5} fill={PALETTE.deskTop} />
      <rect x={x} y={y + 10} width={24} height={3} fill={PALETTE.deskFront} />
      {[x + 4, x + 14].map((cx) => (
        <rect key={cx} x={cx} y={y + 6} width={6} height={2.5} rx={0.5} fill={PALETTE.monitorScreen} />
      ))}
      {[x + 4, x + 14].map((cx) => (
        <rect key={cx} x={cx} y={y + 15} width={6} height={4} rx={1.5} fill={PALETTE.chairSeat} />
      ))}
    </g>
  );
}

function Plant({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 2.5} y={y} width={5} height={4} rx={1} fill={PALETTE.potTop} />
      <circle cx={x - 2} cy={y - 1} r={3} fill={PALETTE.leafDark} />
      <circle cx={x + 2} cy={y - 1.5} r={3} fill={PALETTE.leafLight} />
      <circle cx={x} cy={y - 3.5} r={2.8} fill={PALETTE.leafLight} />
    </g>
  );
}

/**
 * A little floor plan in the office's colours: desk pods, a meeting table or a lounge, plants
 * and a few people. Decorative, and stable per office so each card is recognisable.
 */
export function OfficeThumbnail({ seed, className = '' }: { seed: string; className?: string }) {
  const rand = random(hashString(seed));
  const pods = 2 + Math.floor(rand() * 3);
  const lounge = rand() > 0.5;
  const rug = RUG_COLOURS[Math.floor(rand() * RUG_COLOURS.length)];
  const people = Array.from({ length: 2 + Math.floor(rand() * 3) }, () => ({
    x: 12 + rand() * 90,
    y: 30 + rand() * 44,
    shirt: SHIRT_COLOURS[Math.floor(rand() * SHIRT_COLOURS.length)],
  }));
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width={W} height={H} fill={PALETTE.planks} />
      {Array.from({ length: Math.ceil(H / 6) }, (_, i) => (
        <line key={i} x1={0} x2={W} y1={i * 6 + 0.5} y2={i * 6 + 0.5} stroke={PALETTE.plankLine} strokeWidth={0.6} />
      ))}
      <rect width={W} height={9} fill={PALETTE.wallTop} />
      <rect y={5} width={W} height={6} fill={PALETTE.wallFront} />
      <rect x={112} y={9} width={4} height={H} fill={PALETTE.wallFront} />
      {Array.from({ length: pods }, (_, i) => (
        <DeskPod key={i} x={8 + (i % 3) * 32} y={i < 3 ? 22 : 54} />
      ))}
      {lounge ? (
        <g>
          <rect x={122} y={30} width={32} height={34} rx={5} fill={rug} />
          <rect x={126} y={33} width={24} height={7} rx={2} fill={PALETTE.sofaTop} />
          <rect x={126} y={39} width={24} height={2.5} fill={PALETTE.sofaFront} />
          <circle cx={138} cy={52} r={5} fill={PALETTE.woodTop} />
        </g>
      ) : (
        <g>
          {[124, 133, 142].map((cx) => (
            <rect key={cx} x={cx} y={26} width={6} height={4} rx={1.5} fill={PALETTE.woodFront} />
          ))}
          <rect x={122} y={32} width={30} height={16} rx={2} fill={PALETTE.woodTop} />
          <rect x={122} y={48} width={30} height={3} fill={PALETTE.woodFront} />
          {[124, 133, 142].map((cx) => (
            <rect key={cx} x={cx} y={53} width={6} height={4} rx={1.5} fill={PALETTE.woodFront} />
          ))}
        </g>
      )}
      <Plant x={152} y={74} />
      <Plant x={104} y={16} />
      {people.map((p, i) => (
        <g key={i}>
          <ellipse cx={p.x} cy={p.y + 4} rx={3} ry={1.2} fill={PALETTE.shadow} />
          <rect x={p.x - 2.2} y={p.y - 1} width={4.4} height={5} rx={1.6} fill={p.shirt} />
          <circle cx={p.x} cy={p.y - 2.5} r={2.3} fill="#f1c7a8" />
        </g>
      ))}
    </svg>
  );
}
