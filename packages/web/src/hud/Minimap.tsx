import { useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { OfficeState, PlayerState, Store, Vec3 } from '@officexr/sdk';
import { presenceIndicator } from '@officexr/sdk';
import {
  focusWorld,
  planarDistance,
  useCoarsePointer,
  useNavGrid,
  usePlayControls,
  useStoreSelector,
  useViewYaw,
  type NavGrid,
} from '@officexr/world/react';
import { formatDistance } from './formatDistance';
import { floorPlanTransform, navGridPath, toMinimap } from './minimapGeometry';
import { PRESENCE_INDICATOR } from './presenceColours';
import { quantise } from './quantise';
import { sameFields, sameList } from './sameFields';
import { useNow } from './useNow';

const SIZE_PX = 180;
/** Leaves room outside the map's circle for the labels of users pinned to its rim. */
const RIM_INSET_PX = 12;
const MAP_PX = SIZE_PX - 2 * RIM_INSET_PX;
const RANGE_M = 40;
const CENTRE = SIZE_PX / 2;

type MinimapPeer = Pick<PlayerState, 'id' | 'name' | 'status' | 'lastStatusAt' | 'firstSeenAt'> &
  Vec3 & { distanceM: number };
type Positions = { self: Vec3 | null; peers: MinimapPeer[] };

const selectPositions = (s: OfficeState): Positions => {
  const selfPos = s.players[s.selfId]?.pos;
  if (!selfPos) {
    return { self: null, peers: [] };
  }
  return {
    self: { x: quantise(selfPos.x, 0.25), y: 0, z: quantise(selfPos.z, 0.25) },
    peers: Object.values(s.players)
      .filter((p) => p.id !== s.selfId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        lastStatusAt: p.lastStatusAt,
        firstSeenAt: p.firstSeenAt,
        x: quantise(p.pos.x, 0.5),
        y: 0,
        z: quantise(p.pos.z, 0.5),
        distanceM: Math.floor(planarDistance(selfPos, p.pos)),
      })),
  };
};
const samePositions = (a: Positions, b: Positions) =>
  (a.self === b.self || (a.self !== null && b.self !== null && sameFields(a.self, b.self))) &&
  sameList(a.peers, b.peers);

export function Minimap({
  store,
  clock,
}: {
  store: Store;
  /** Must be stable; defaults to `performance.now`, the clock presence timestamps are on. */
  clock?: () => number;
}) {
  const coarse = useCoarsePointer();
  const [open, setOpen] = useState(!coarse);
  const mapId = useId();
  const toggle = () => {
    setOpen((o) => !o);
    focusWorld();
  };
  return (
    <div data-studio-panel className="pointer-events-auto rounded bg-black/70 p-2 text-xs text-white">
      <div className="flex items-center justify-between gap-3 font-medium">
        Map
        {/* preventDefault on mousedown keeps focus off the button, so Space/Enter keep driving the world. */}
        <button
          type="button"
          aria-label={open ? 'Hide map' : 'Show map'}
          aria-expanded={open}
          aria-controls={mapId}
          onMouseDown={(e) => e.preventDefault()}
          onClick={toggle}
          className="rounded p-0.5 hover:bg-white/20"
        >
          {open ? <ChevronDown aria-hidden className="h-3 w-3" /> : <ChevronUp aria-hidden className="h-3 w-3" />}
        </button>
      </div>
      {open && <MapView id={mapId} store={store} clock={clock} />}
    </div>
  );
}

function MapView({ id, store, clock }: { id: string; store: Store; clock?: () => number }) {
  const { self, peers } = useStoreSelector(store, selectPositions, samePositions);
  const clipId = useId();
  const viewYaw = useViewYaw();
  const now = useNow(1000, clock);
  const grid = useNavGrid();
  const { state } = usePlayControls();
  return (
    <svg
      id={id}
      role="group"
      aria-label="Map"
      width={SIZE_PX}
      height={SIZE_PX}
      viewBox={`0 0 ${SIZE_PX} ${SIZE_PX}`}
      className="mt-1 block"
    >
      <clipPath id={clipId}>
        <circle cx={CENTRE} cy={CENTRE} r={MAP_PX / 2} />
      </clipPath>
      <circle cx={CENTRE} cy={CENTRE} r={MAP_PX / 2} className="fill-white/10" />
      {self && grid && <FloorPlan grid={grid} self={self} viewYaw={viewYaw} clipId={clipId} />}
      {self && state.type === 'walking' && <RouteLine route={state.route} self={self} viewYaw={viewYaw} />}
      {self && peers.map((p) => <PeerMarker key={p.id} peer={p} self={self} viewYaw={viewYaw} now={now} />)}
      <path role="img" aria-label="You" d={`M${CENTRE} ${CENTRE - 7}l5 12h-10z`} className="fill-white stroke-black/60">
        <title>You</title>
      </path>
    </svg>
  );
}

function PeerMarker({ peer, self, viewYaw, now }: { peer: MinimapPeer; self: Vec3; viewYaw: number; now: number }) {
  const { x, y } = toMinimap(self, viewYaw, peer, { rangeM: RANGE_M, sizePx: MAP_PX });
  const cx = x + RIM_INSET_PX;
  const cy = y + RIM_INSET_PX;
  const name = peer.name || 'Joining…';
  return (
    <g role="img" aria-label={`${name}, ${formatDistance(peer.distanceM)}`}>
      <title>{name}</title>
      <circle cx={cx} cy={cy} r={4} className={PRESENCE_INDICATOR[presenceIndicator(peer, now)].fill} />
      <text x={cx} y={cy + 12} textAnchor="middle" className="fill-white text-[9px] tabular-nums">
        {formatDistance(peer.distanceM)}
      </text>
    </g>
  );
}

// ponytail: waypoints beyond the map's range are pinned to its rim, so a long route bends along the edge.
function RouteLine({ route, self, viewYaw }: { route: { x: number; z: number }[]; self: Vec3; viewYaw: number }) {
  const points = route.map((p) => {
    const { x, y } = toMinimap(self, viewYaw, { x: p.x, y: 0, z: p.z }, { rangeM: RANGE_M, sizePx: MAP_PX });
    return `${x + RIM_INSET_PX},${y + RIM_INSET_PX}`;
  });
  return (
    <polyline
      points={[`${CENTRE},${CENTRE}`, ...points].join(' ')}
      className="fill-none stroke-sky-400"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function FloorPlan({ grid, self, viewYaw, clipId }: { grid: NavGrid; self: Vec3; viewYaw: number; clipId: string }) {
  const { a, b, c, d, e, f } = floorPlanTransform(grid, self, viewYaw, {
    rangeM: RANGE_M,
    sizePx: MAP_PX,
    centre: CENTRE,
  });
  return (
    <g clipPath={`url(#${clipId})`}>
      <path d={navGridPath(grid)} transform={`matrix(${a} ${b} ${c} ${d} ${e} ${f})`} className="fill-white/40" />
    </g>
  );
}
