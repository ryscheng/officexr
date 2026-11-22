import { memo } from 'react';
import { planShape, type RoomLabel } from './mapGeometry';
import type { PlanRect, PlanTone } from './minimapPlan';
import type { Area, PlaceAreas } from './missions/missionRows';

const PROP_FILL: Record<Exclude<PlanTone, 'floor' | 'wall'>, string> = {
  rug: 'fill-map-rug',
  desk: 'fill-map-desk',
  seat: 'fill-map-seat',
  furniture: 'fill-map-furniture',
};

const ROOM_TINTS = [
  { fill: 'fill-map-room-1/15', edge: 'stroke-map-room-1/60' },
  { fill: 'fill-map-room-2/15', edge: 'stroke-map-room-2/60' },
  { fill: 'fill-map-room-3/15', edge: 'stroke-map-room-3/60' },
  { fill: 'fill-map-room-4/15', edge: 'stroke-map-room-4/60' },
];

const CORNER_M = 0.4;
const SEAM_M = 0.03;

function Footprint({ rect }: { rect: PlanRect }) {
  const { round, radius } = planShape(rect);
  const className = rect.tone === 'wall' ? 'fill-map-wall' : `${PROP_FILL[rect.tone as keyof typeof PROP_FILL]} stroke-hud-text/15`;
  if (round) {
    return <circle cx={rect.x + rect.w / 2} cy={rect.z + rect.d / 2} r={radius} strokeWidth={1} className={className} />;
  }
  return <rect x={rect.x} y={rect.z} width={rect.w} height={rect.d} rx={radius} strokeWidth={rect.tone === 'wall' ? 0 : 1} className={className} />;
}

function Room({ area, index, active }: { area: Area; index: number; active: boolean }) {
  const tint = ROOM_TINTS[index % ROOM_TINTS.length];
  return (
    <rect
      x={area.min.x}
      y={area.min.z}
      width={area.max.x - area.min.x}
      height={area.max.z - area.min.z}
      rx={CORNER_M}
      strokeWidth={active ? 2.5 : 1.5}
      className={active ? 'fill-hud-accent/15 stroke-hud-accent' : `${tint.fill} ${tint.edge}`}
    />
  );
}

export const MapFloor = memo(function MapFloor({
  plan,
  areas,
  activeAreaId,
}: {
  plan: readonly PlanRect[];
  areas: PlaceAreas;
  activeAreaId: string | null;
}) {
  const floors = plan.filter((r) => r.tone === 'floor');
  const props = plan.filter((r) => r.tone !== 'floor' && r.tone !== 'wall');
  const walls = plan.filter((r) => r.tone === 'wall');
  return (
    <g>
      <g className="stroke-map-wall opacity-35" strokeWidth={5} strokeLinejoin="miter">
        {floors.map((r, i) => (
          <rect key={i} x={r.x} y={r.z} width={r.w} height={r.d} className="fill-none" />
        ))}
      </g>
      <g strokeWidth={0}>
        {floors.map((r, i) => (
          <rect key={i} x={r.x - SEAM_M} y={r.z - SEAM_M} width={r.w + 2 * SEAM_M} height={r.d + 2 * SEAM_M} className="fill-map-floor" />
        ))}
      </g>
      {areas.rooms.map((a, i) => (
        <Room key={a.id} area={a} index={i} active={activeAreaId === a.id} />
      ))}
      {props.map((r, i) => (
        <Footprint key={i} rect={r} />
      ))}
      {walls.map((r, i) => (
        <Footprint key={i} rect={r} />
      ))}
      {areas.desks.map((a) => (
        <rect
          key={a.id}
          x={a.min.x}
          y={a.min.z}
          width={a.max.x - a.min.x}
          height={a.max.z - a.min.z}
          rx={CORNER_M / 2}
          strokeWidth={1}
          strokeDasharray="3 3"
          className="fill-none stroke-hud-text-2/50"
        />
      ))}
    </g>
  );
});

const LABEL_PX = 12;

export function RoomLabels({ labels, scale, activeAreaId }: { labels: readonly RoomLabel[]; scale: number; activeAreaId: string | null }) {
  return (
    <g className="pointer-events-none" fontSize={LABEL_PX * scale} fontWeight={600} textAnchor="middle" dominantBaseline="central">
      {labels.map((l) => (
        <text
          key={l.id}
          x={l.x}
          y={l.z}
          strokeWidth={3}
          strokeLinejoin="round"
          paintOrder="stroke"
          className={`stroke-map-floor ${activeAreaId === l.id ? 'fill-hud-accent' : 'fill-hud-text-2'}`}
        >
          {l.text}
        </text>
      ))}
    </g>
  );
}
