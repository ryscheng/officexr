import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Map as MapIcon } from 'lucide-react';
import type { OfficeState, Store } from '@officexr/sdk';
import { presenceIndicator } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { MapFloor, RoomLabels } from './FullMapFloor';
import { PeerMarker, SelfMarker, SelfTrail } from './FullMapPeople';
import { formatDistance } from './formatDistance';
import { mapBounds, markerSize, namedPeople, placeRoomLabels, readPlan } from './mapGeometry';
import { clientToMap, type MapBox } from './mapPoint';
import { distanceBetween, type PlaceAreas, type Spot } from './missions/missionRows';
import type { PlanRect } from './minimapPlan';
import { quantise } from './quantise';
import { sameFields, sameList } from './sameFields';
import { Panel } from './ui/Panel';
import { useEscapeLayer } from './useEscapeLayer';
import { useNow } from './useNow';

type Peer = { id: string; name: string; x: number; z: number; yaw: number; status: OfficeState['players'][string]['status']; lastStatusAt: number | undefined; firstSeenAt: number | undefined };
type Positions = { self: { x: number; z: number } | null; peers: Peer[] };

const YAW_STEP = Math.PI / 12;

const selectPositions = (s: OfficeState): Positions => {
  const me = s.players[s.selfId];
  return {
    self: me ? { x: quantise(me.pos.x, 1), z: quantise(me.pos.z, 1) } : null,
    peers: Object.values(s.players)
      .filter((p) => p.id !== s.selfId)
      .map((p) => ({ id: p.id, name: p.name, x: quantise(p.pos.x, 0.5), z: quantise(p.pos.z, 0.5), yaw: quantise(p.yaw ?? 0, YAW_STEP), status: p.status, lastStatusAt: p.lastStatusAt, firstSeenAt: p.firstSeenAt })),
  };
};
const samePositions = (a: Positions, b: Positions) =>
  (a.self === b.self || (a.self !== null && b.self !== null && sameFields(a.self, b.self))) && sameList(a.peers, b.peers);

const FALLBACK_PX_PER_M = 8;

function useMetresPerPixel(box: MapBox) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const read = () => {
      const r = el.getBoundingClientRect();
      const next = { w: Math.round(r.width), h: Math.round(r.height) };
      setSize((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const pxPerM = size && size.w > 0 && size.h > 0 ? Math.min(size.w / box.w, size.h / box.h) : FALLBACK_PX_PER_M;
  return { ref, scale: 1 / pxPerM };
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
  const read = useMemo(() => readPlan(plan), [plan]);
  const view = useMemo(() => mapBounds([...areas.rooms, ...areas.desks], read, [...positions.peers, ...(positions.self ? [positions.self] : [])]), [areas, read, positions]);
  const { ref, scale } = useMetresPerPixel(view);
  const size = markerSize(1 / scale);
  const people = positions.peers.length + (positions.self ? 1 : 0);
  const metres = route && positions.self ? distanceBetween(positions.self, route.to) : null;
  const labels = useMemo(() => placeRoomLabels(areas.rooms, positions.peers, scale, 12), [areas.rooms, positions.peers, scale]);
  const named = useMemo(() => namedPeople(positions.peers, scale), [positions.peers, scale]);
  const missionTail = useMemo(() => (route ? [route.to] : null), [route]);
  const walkTail = useMemo(() => (walk ? (walk.route.length > 0 ? walk.route : [walk.target]) : null), [walk]);
  const goTo = (e: MouseEvent<SVGSVGElement>) => {
    setRefused(!onGoTo(clientToMap(e.currentTarget.getBoundingClientRect(), view, e.clientX, e.clientY)));
  };
  const pinText = route ? `${route.label}${metres === null ? '' : ` · ${formatDistance(metres)}`}` : '';
  const pinWidth = pinText.length * 6.8 + 22;
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
          ref={ref}
          role="img"
          aria-label="Map of the office"
          viewBox={`${view.x} ${view.z} ${view.w} ${view.h}`}
          preserveAspectRatio="xMidYMid meet"
          onClick={goTo}
          className="min-h-0 w-full flex-1 cursor-crosshair rounded-2xl bg-map-bg shadow-[inset_0_0_0_1px_var(--color-hud-hairline)] [&_*]:[vector-effect:non-scaling-stroke]"
          style={{ aspectRatio: `${view.w} / ${view.h}`, maxHeight: '60dvh' }}
        >
          <MapFloor plan={read} areas={areas} activeAreaId={route?.areaId ?? null} />
          <RoomLabels labels={labels} scale={scale} activeAreaId={route?.areaId ?? null} />
          {missionTail && positions.self && <SelfTrail store={store} tail={missionTail} />}
          {walkTail && positions.self && <SelfTrail store={store} tail={walkTail} />}
          {route && (
            <g transform={`translate(${route.to.x} ${route.to.z}) scale(${scale})`} className="pointer-events-none">
              <circle r={7} strokeWidth={3} className="fill-hud-accent stroke-hud-contrast" />
              <g transform="translate(0 -18)">
                <rect x={-pinWidth / 2} y={-11} width={pinWidth} height={22} rx={11} className="fill-hud-accent" />
                <text y={1} textAnchor="middle" dominantBaseline="central" fontSize={12} fontWeight={600} className="fill-hud-on-accent">
                  {pinText}
                </text>
              </g>
            </g>
          )}
          {walk && (
            <g role="img" aria-label="Walking here" transform={`translate(${walk.target.x} ${walk.target.z}) scale(${scale})`}>
              <circle r={15} strokeWidth={2} className="fill-hud-accent/20 stroke-hud-accent" />
              <circle r={5} strokeWidth={2.5} className="fill-hud-accent stroke-hud-contrast" />
            </g>
          )}
          {positions.peers.map((p) => (
            <PeerMarker key={p.id} scale={scale} size={size} named={named.has(p.id)} peer={{ id: p.id, name: p.name, x: p.x, z: p.z, yaw: p.yaw, presence: presenceIndicator(p, now) }} />
          ))}
          {positions.self && <SelfMarker store={store} scale={scale} size={size} />}
        </svg>
        <p role="status" className={`text-center text-xs ${refused ? 'font-semibold text-hud-text' : 'text-hud-text-2'}`}>
          {refused ? "Can't go there" : 'Tap the map to walk there'}
        </p>
        <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-xs text-hud-text-2 [@media(max-height:500px)]:hidden" aria-label="Legend">
          <li><span aria-hidden className="mr-1 inline-block size-2 rounded-full border-[1.5px] border-green-500" />Available</li>
          <li><span aria-hidden className="mr-1 inline-block size-2 rounded-full border-[1.5px] border-yellow-400" />Away</li>
          <li><span aria-hidden className="mr-1 inline-block size-2 rounded-full border-[1.5px] border-red-500" />Unresponsive</li>
          <li><span aria-hidden className="mr-1 inline-block h-2 w-2.5 rounded-xs border border-map-room-1/60 bg-map-room-1/15" />Room</li>
          <li><span aria-hidden className="mr-1 inline-block size-2 rounded-full bg-hud-accent" />You</li>
        </ul>
      </Panel>
    </div>
  );
}
