import { useEffect, useState, type MouseEvent } from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { OfficeState, Store } from '@officexr/sdk';
import { presenceIndicator } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { formatDistance } from './formatDistance';
import { clientToMap } from './mapPoint';
import { distanceBetween, type Area, type PlaceAreas, type Spot } from './missions/missionRows';
import type { PlanRect, PlanTone } from './minimapPlan';
import { PRESENCE_INDICATOR } from './presenceColours';
import { quantise } from './quantise';
import { sameFields, sameList } from './sameFields';
import { Panel } from './ui/Panel';
import { useEscapeLayer } from './useEscapeLayer';
import { useNow } from './useNow';

type Peer = { id: string; name: string; x: number; z: number; status: OfficeState['players'][string]['status']; lastStatusAt: number | undefined; firstSeenAt: number | undefined };
type Positions = { self: { x: number; z: number } | null; peers: Peer[] };

const selectPositions = (s: OfficeState): Positions => {
  const me = s.players[s.selfId];
  return {
    self: me ? { x: quantise(me.pos.x, 0.25), z: quantise(me.pos.z, 0.25) } : null,
    peers: Object.values(s.players)
      .filter((p) => p.id !== s.selfId)
      .map((p) => ({ id: p.id, name: p.name, x: quantise(p.pos.x, 0.5), z: quantise(p.pos.z, 0.5), status: p.status, lastStatusAt: p.lastStatusAt, firstSeenAt: p.firstSeenAt })),
  };
};
const samePositions = (a: Positions, b: Positions) =>
  (a.self === b.self || (a.self !== null && b.self !== null && sameFields(a.self, b.self))) && sameList(a.peers, b.peers);

const PLAN_FILL: Record<PlanTone, string> = {
  floor: 'fill-map-floor',
  rug: 'fill-map-rug',
  desk: 'fill-map-desk',
  seat: 'fill-map-seat',
  furniture: 'fill-map-furniture',
  wall: 'fill-map-wall',
};

const PAD_M = 3;

function bounds(areas: PlaceAreas, plan: readonly PlanRect[], positions: Positions) {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const a of [...areas.rooms, ...areas.desks]) {
    xs.push(a.min.x, a.max.x);
    zs.push(a.min.z, a.max.z);
  }
  if (areas.rooms.length === 0) {
    for (const r of plan) {
      xs.push(r.x, r.x + r.w);
      zs.push(r.z, r.z + r.d);
    }
  }
  for (const p of [...positions.peers, ...(positions.self ? [positions.self] : [])]) {
    xs.push(p.x);
    zs.push(p.z);
  }
  if (xs.length === 0) {
    return { x: 0, z: 0, w: 40, h: 40 };
  }
  const x = Math.min(...xs) - PAD_M;
  const z = Math.min(...zs) - PAD_M;
  return { x, z, w: Math.max(...xs) + PAD_M - x, h: Math.max(...zs) + PAD_M - z };
}

export type FullMapRoute = { to: Spot; label: string; areaId: string | null };
export type FullMapWalk = { target: Spot; route: readonly Spot[] };

const NOTICE_MS = 3000;

export function FullMap({
  store,
  officeName,
  areas,
  plan = [],
  route,
  walk = null,
  onGoTo,
  onClose,
}: {
  store: Store;
  officeName: string;
  areas: PlaceAreas;
  plan?: readonly PlanRect[];
  route: FullMapRoute | null;
  walk?: FullMapWalk | null;
  onGoTo: (to: Spot) => boolean;
  onClose: () => void;
}) {
  useEscapeLayer(true, onClose);
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    if (!refused) {
      return;
    }
    const timer = setTimeout(() => setRefused(false), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [refused]);
  const positions = useStoreSelector(store, selectPositions, samePositions);
  const now = useNow(1000);
  const box = bounds(areas, plan, positions);
  const u = Math.max(box.w, box.h) / 100;
  const people = positions.peers.length + (positions.self ? 1 : 0);
  const metres = route && positions.self ? distanceBetween(positions.self, route.to) : null;
  const goTo = (e: MouseEvent<SVGSVGElement>) => {
    setRefused(!onGoTo(clientToMap(e.currentTarget.getBoundingClientRect(), box, e.clientX, e.clientY)));
  };
  return (
    <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center px-3 pt-[calc(var(--hud-inset-top)+3.5rem)] pb-3 sm:px-8 sm:pb-8">
      <div aria-hidden className="pointer-events-auto absolute inset-x-0 top-[calc(var(--hud-inset-top)+3.5rem)] bottom-0" />
      <Panel material="thick" role="dialog" data-map-dialog aria-label="Office map" className="pointer-events-auto relative flex max-h-full w-full max-w-225 flex-col gap-3 p-4 pointer-coarse:p-3">
        <div className="flex items-center gap-3">
          <MapIcon aria-hidden className="size-5 shrink-0" />
          <h2 className="truncate text-lg font-semibold">{officeName}</h2>
          <span className="shrink-0 text-xs text-hud-text-2">{people} {people === 1 ? 'person' : 'people'} here</span>
          <span className="ml-auto hidden truncate text-xs text-hud-text-2 sm:block">
            {route ? `Route to current mission${metres === null ? '' : ` · ${formatDistance(metres)}`}` : 'No current mission'}
          </span>
        </div>
        <svg
          role="img"
          aria-label="Map of the office"
          viewBox={`${box.x} ${box.z} ${box.w} ${box.h}`}
          preserveAspectRatio="xMidYMid meet"
          onClick={goTo}
          className="min-h-0 w-full flex-1 cursor-crosshair rounded-2xl bg-hud-inset"
          style={{ aspectRatio: `${box.w} / ${box.h}`, maxHeight: '60dvh' }}
        >
          {areas.rooms.length === 0 &&
            plan.map((r, i) => (
              <rect key={i} x={r.x} y={r.z} width={r.w} height={r.d} className={PLAN_FILL[r.tone]} />
            ))}
          {areas.rooms.map((a) => (
            <RoomBox key={a.id} area={a} u={u} active={route?.areaId === a.id} />
          ))}
          {areas.desks.map((a) => (
            <rect key={a.id} x={a.min.x} y={a.min.z} width={a.max.x - a.min.x} height={a.max.z - a.min.z} rx={u * 0.6} className="fill-none stroke-hud-text-2/40" strokeWidth={u * 0.3} />
          ))}
          {route && positions.self && (
            <>
              <line
                x1={positions.self.x}
                y1={positions.self.z}
                x2={route.to.x}
                y2={route.to.z}
                className="stroke-hud-accent"
                strokeWidth={u * 0.8}
                strokeDasharray={`${u * 0.1} ${u * 1.6}`}
                strokeLinecap="round"
              />
              <g transform={`translate(${route.to.x} ${route.to.z})`}>
                <rect x={-u * 15} y={u * 2.2} width={u * 30} height={u * 3.6} rx={u * 1.8} className="fill-hud-accent" />
                <text x={0} y={u * 4.7} textAnchor="middle" fontSize={u * 2} fontWeight={600} className="fill-hud-on-accent">
                  {route.label}
                  {metres === null ? '' : ` · ${formatDistance(metres)}`}
                </text>
                <circle r={u * 1.1} className="fill-hud-accent stroke-hud-contrast" strokeWidth={u * 0.3} />
              </g>
            </>
          )}
          {walk && (
            <>
              {positions.self && (
                <polyline
                  points={[positions.self, ...(walk.route.length > 0 ? walk.route : [walk.target])].map((p) => `${p.x},${p.z}`).join(' ')}
                  fill="none"
                  className="stroke-hud-accent"
                  strokeWidth={u * 0.8}
                  strokeDasharray={`${u * 0.1} ${u * 1.6}`}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              <g role="img" aria-label="Walking here" transform={`translate(${walk.target.x} ${walk.target.z})`}>
                <circle r={u * 2.2} className="fill-hud-accent/20 stroke-hud-accent" strokeWidth={u * 0.4} />
                <circle r={u * 0.9} className="fill-hud-accent stroke-hud-contrast" strokeWidth={u * 0.3} />
              </g>
            </>
          )}
          {positions.peers.map((p) => (
            <Dot key={p.id} x={p.x} z={p.z} u={u} name={p.name} presence={PRESENCE_INDICATOR[presenceIndicator(p, now)].fill} />
          ))}
          {positions.self && (
            <g role="img" aria-label="You" transform={`translate(${positions.self.x} ${positions.self.z}) scale(${u * 0.28})`}>
              <title>You</title>
              <path d="M0 -8.5L6.5 6.5L0 3L-6.5 6.5Z" strokeWidth={1.75} strokeLinejoin="round" className="fill-hud-accent stroke-hud-contrast" />
            </g>
          )}
        </svg>
        <p role="status" className={`text-center text-xs ${refused ? 'font-semibold text-hud-text' : 'text-hud-text-2'}`}>
          {refused ? "Can't go there" : 'Tap the map to walk there'}
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-hud-text-2" aria-label="Legend">
          <li><span aria-hidden className="mr-1.5 inline-block size-2.5 rounded-full border-2 border-green-500" />Available</li>
          <li><span aria-hidden className="mr-1.5 inline-block size-2.5 rounded-full border-2 border-yellow-400" />Away</li>
          <li><span aria-hidden className="mr-1.5 inline-block size-2.5 rounded-full border-2 border-red-500" />Unresponsive</li>
          <li><span aria-hidden className="mr-1.5 inline-block h-2.5 w-3 rounded-sm border border-hud-text-2" />Room</li>
          <li><span aria-hidden className="mr-1.5 inline-block text-hud-accent">▲</span>You</li>
        </ul>
      </Panel>
    </div>
  );
}

function RoomBox({ area, u, active }: { area: Area; u: number; active: boolean }) {
  return (
    <g>
      <rect
        x={area.min.x}
        y={area.min.z}
        width={area.max.x - area.min.x}
        height={area.max.z - area.min.z}
        rx={u * 1.2}
        strokeWidth={u * (active ? 0.5 : 0.25)}
        className={active ? 'fill-green-500/15 stroke-green-500' : 'fill-hud-text/5 stroke-hud-text-2/50'}
      />
      <text x={area.min.x + u * 1.5} y={area.min.z + u * 3.4} fontSize={u * 2.4} fontWeight={600} className="fill-hud-text">
        {area.label}
      </text>
    </g>
  );
}

function Dot({ x, z, u, name, presence }: { x: number; z: number; u: number; name: string; presence: string }) {
  return (
    <g role="img" aria-label={name || 'Joining'}>
      <title>{name || 'Joining'}</title>
      <circle cx={x} cy={z} r={u * 2.1} strokeWidth={u * 0.5} className={`${presence} stroke-hud-contrast`} />
      <circle cx={x} cy={z} r={u * 1.6} className="fill-hud-contrast" />
      <text x={x} y={z + u * 0.8} textAnchor="middle" fontSize={u * 2.2} fontWeight={700} className="fill-hud-text">
        {name.charAt(0).toUpperCase()}
      </text>
    </g>
  );
}
