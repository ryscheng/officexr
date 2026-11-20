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
} from '@officexr/world/top-down';
import { formatDistance } from './formatDistance';
import { floorPlanTransform, navGridPath, toMinimap, worldPlanTransform } from './minimapGeometry';
import type { PlanRect, PlanTone } from './minimapPlan';
import { PRESENCE_INDICATOR } from './presenceColours';
import { quantise } from './quantise';
import { sameFields, sameList } from './sameFields';
import { CHIP, Panel, PanelTitle } from './ui/Panel';
import { useNow } from './useNow';

const SIZE_PX = 180;
/** Leaves room outside the map's circle for the labels of users pinned to its rim. */
const RIM_INSET_PX = 12;
const MAP_PX = SIZE_PX - 2 * RIM_INSET_PX;
const RANGE_M = 40;
const CENTRE = SIZE_PX / 2;
/** The map is a rounded tile, like a maps-app widget. */
const MAP_RADIUS_PX = 18;

type MinimapPeer = Pick<PlayerState, 'id' | 'name' | 'status' | 'lastStatusAt' | 'firstSeenAt'> &
  Vec3 & { distanceM: number };
/** `selfYaw` is quantised to 10°, so turning re-renders only when the arrow visibly turns. */
type Positions = { self: Vec3 | null; selfYaw: number; peers: MinimapPeer[] };

const selectPositions = (s: OfficeState): Positions => {
  const selfPos = s.players[s.selfId]?.pos;
  if (!selfPos) {
    return { self: null, selfYaw: 0, peers: [] };
  }
  return {
    self: { x: quantise(selfPos.x, 0.25), y: 0, z: quantise(selfPos.z, 0.25) },
    selfYaw: quantise(s.players[s.selfId]?.yaw ?? 0, Math.PI / 18),
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
  a.selfYaw === b.selfYaw &&
  (a.self === b.self || (a.self !== null && b.self !== null && sameFields(a.self, b.self))) &&
  sameList(a.peers, b.peers);

export function Minimap({
  store,
  clock,
  alwaysOpen = false,
  plan,
}: {
  store: Store;
  /** Must be stable; defaults to `performance.now`, the clock presence timestamps are on. */
  clock?: () => number;
  /** Hides the collapse toggle and keeps the map shown. */
  alwaysOpen?: boolean;
  /** The office's floor plan in world metres (see `OfficeMinimap`); without it only walkable floor is drawn. */
  plan?: readonly PlanRect[];
}) {
  const coarse = useCoarsePointer();
  const [expanded, setExpanded] = useState(!coarse);
  const open = alwaysOpen || expanded;
  const mapId = useId();
  const toggle = () => {
    setExpanded((o) => !o);
    focusWorld();
  };
  if (coarse && !open) {
    return (
      <button
        type="button"
        aria-label="Show map"
        aria-expanded={false}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        className={`pointer-events-auto p-1 ${CHIP}`}
      >
        <MapView store={store} clock={clock} plan={plan} className="block size-20" />
      </button>
    );
  }
  return (
    // Same width as the roster below it, so the right-hand column reads as one stack.
    <Panel className="pointer-events-auto w-60 p-2 text-xs">
      <div className="flex items-center justify-between gap-3 px-1">
        <PanelTitle className="text-xs">Map</PanelTitle>
        {/* preventDefault on mousedown keeps focus off the button, so Space/Enter keep driving the world. */}
        {!alwaysOpen && (
          <button
            type="button"
            aria-label={open ? 'Hide map' : 'Show map'}
            aria-expanded={open}
            aria-controls={mapId}
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggle}
            className="rounded-md p-0.5 text-hud-text-2 hover:bg-hud-hover hover:text-hud-text pointer-coarse:min-h-12 pointer-coarse:min-w-12"
          >
            {open ? <ChevronDown aria-hidden className="h-3 w-3" /> : <ChevronUp aria-hidden className="h-3 w-3" />}
          </button>
        )}
      </div>
      {open && <MapView id={mapId} store={store} clock={clock} plan={plan} />}
    </Panel>
  );
}

function MapView({
  id,
  store,
  clock,
  plan,
  className = 'mt-1 block h-auto w-full',
}: {
  id?: string;
  store: Store;
  clock?: () => number;
  plan?: readonly PlanRect[];
  className?: string;
}) {
  const { self, selfYaw, peers } = useStoreSelector(store, selectPositions, samePositions);
  const clipId = useId();
  const viewYaw = useViewYaw();
  const now = useNow(1000, clock);
  const grid = useNavGrid();
  const { state } = usePlayControls();
  // Yaw turns counter-clockwise seen from above; the map is turned so the view's yaw points up.
  const heading = (-(selfYaw - viewYaw) * 180) / Math.PI;
  return (
    <svg
      id={id}
      role="group"
      aria-label="Map"
      width={SIZE_PX}
      height={SIZE_PX}
      viewBox={`0 0 ${SIZE_PX} ${SIZE_PX}`}
      className={className}
    >
      <clipPath id={clipId}>
        <rect width={SIZE_PX} height={SIZE_PX} rx={MAP_RADIUS_PX} />
      </clipPath>
      <rect width={SIZE_PX} height={SIZE_PX} rx={MAP_RADIUS_PX} className="fill-map-bg" />
      {self && grid && <FloorPlan grid={grid} self={self} viewYaw={viewYaw} clipId={clipId} />}
      {self && plan && plan.length > 0 && <PlanLayer plan={plan} self={self} viewYaw={viewYaw} clipId={clipId} />}
      {self && state.type === 'walking' && (
        <RouteLine
          route={state.route}
          target={peers.find((p) => p.id === state.targetId)}
          self={self}
          viewYaw={viewYaw}
          clipId={clipId}
        />
      )}
      {self && peers.map((p) => <PeerMarker key={p.id} peer={p} self={self} viewYaw={viewYaw} now={now} />)}
      {/* You: a navigation arrow pointing where you face, on a soft halo, like a maps app. */}
      <g role="img" aria-label="You">
        <title>You</title>
        <circle cx={CENTRE} cy={CENTRE} r={13} className="fill-hud-accent/15" />
        <g transform={`translate(${CENTRE} ${CENTRE}) rotate(${heading})`}>
          <path d="M0 -8.5L6.5 6.5L0 3L-6.5 6.5Z" strokeWidth={1.75} strokeLinejoin="round" className="fill-hud-accent stroke-hud-contrast" />
        </g>
      </g>
      <rect width={SIZE_PX} height={SIZE_PX} rx={MAP_RADIUS_PX} className="fill-none stroke-hud-hairline" />
    </svg>
  );
}

/** Pastel, low-detail fills: a floor plan you read at a glance, not a picture of the room. */
const PLAN_FILL: Record<PlanTone, string> = {
  floor: 'fill-map-floor',
  rug: 'fill-map-rug',
  desk: 'fill-map-desk',
  seat: 'fill-map-seat',
  furniture: 'fill-map-furniture',
  wall: 'fill-map-wall',
};

/** The office's objects, drawn in world metres under one transform, so moving only rewrites the matrix. */
function PlanLayer({ plan, self, viewYaw, clipId }: { plan: readonly PlanRect[]; self: Vec3; viewYaw: number; clipId: string }) {
  const { a, b, c, d, e, f } = worldPlanTransform(self, viewYaw, { rangeM: RANGE_M, sizePx: MAP_PX, centre: CENTRE });
  return (
    <g clipPath={`url(#${clipId})`}>
      <g transform={`matrix(${a} ${b} ${c} ${d} ${e} ${f})`}>
        {plan.map((r, i) => (
          <rect key={i} x={r.x} y={r.z} width={r.w} height={r.d} rx={r.tone === 'wall' ? 0 : 0.15} className={PLAN_FILL[r.tone]} />
        ))}
      </g>
    </g>
  );
}

/** How far a rim-pinned peer's label sits in from its dot, towards the centre, so it stays inside the map. */
const RIM_LABEL_INSET_PX = 15;
const AVATAR_R = 6;

/**
 * A person: their initial on a white disc ringed in their presence colour. Out of range they ride
 * the rim, smaller, with a chevron pointing their way and their distance; in range the map itself
 * shows how far (and the roster and the accessible name say it).
 */
function PeerMarker({ peer, self, viewYaw, now }: { peer: MinimapPeer; self: Vec3; viewYaw: number; now: number }) {
  const { x, y, clamped } = toMinimap(self, viewYaw, peer, { rangeM: RANGE_M, sizePx: MAP_PX });
  const cx = x + RIM_INSET_PX;
  const cy = y + RIM_INSET_PX;
  const name = peer.name || 'Joining…';
  const presence = PRESENCE_INDICATOR[presenceIndicator(peer, now)].fill;
  const r = clamped ? AVATAR_R - 2 : AVATAR_R;
  const angle = Math.atan2(cy - CENTRE, cx - CENTRE);
  const label = { x: cx - Math.cos(angle) * RIM_LABEL_INSET_PX, y: cy - Math.sin(angle) * RIM_LABEL_INSET_PX + 3 };
  return (
    <g role="img" aria-label={`${name}, ${formatDistance(peer.distanceM)}`}>
      <title>{name}</title>
      <circle cx={cx} cy={cy} r={r + 1.75} strokeWidth={1} className={`${presence} stroke-hud-contrast`} />
      <circle cx={cx} cy={cy} r={r} className="fill-hud-contrast" />
      {clamped && (
        <g transform={`translate(${cx} ${cy}) rotate(${(angle * 180) / Math.PI}) translate(${r + 4} 0)`}>
          <path d="M4 0L-1 -3.5V3.5z" className={presence} />
        </g>
      )}
      <text
        x={cx}
        y={cy + (clamped ? 2.6 : 2.9)}
        textAnchor="middle"
        aria-hidden
        className={`fill-hud-text font-bold uppercase ${clamped ? 'text-[7px]' : 'text-[8px]'}`}
      >
        {name.charAt(0)}
      </text>
      {clamped && (
        <text
          x={label.x}
          y={label.y}
          textAnchor="middle"
          strokeWidth={3}
          paintOrder="stroke"
          className="fill-hud-text stroke-hud-contrast text-[8.5px] font-semibold tabular-nums"
        >
          {formatDistance(peer.distanceM)}
        </text>
      )}
    </g>
  );
}

/** You, then each waypoint, then the target; clipped rather than clamped so far legs keep their direction. */
function RouteLine({
  route,
  target,
  self,
  viewYaw,
  clipId,
}: {
  route: { x: number; z: number }[];
  target: Vec3 | undefined;
  self: Vec3;
  viewYaw: number;
  clipId: string;
}) {
  const stops = target ? [...route, target] : route;
  const points = stops.map((p) => {
    const { x, y } = toMinimap(self, viewYaw, { x: p.x, y: 0, z: p.z }, { rangeM: RANGE_M, sizePx: MAP_PX, clamp: false });
    return `${x + RIM_INSET_PX},${y + RIM_INSET_PX}`;
  });
  return (
    <polyline
      points={[`${CENTRE},${CENTRE}`, ...points].join(' ')}
      clipPath={`url(#${clipId})`}
      className="fill-none stroke-hud-accent"
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
      <path d={navGridPath(grid)} transform={`matrix(${a} ${b} ${c} ${d} ${e} ${f})`} className="fill-map-walkable" />
    </g>
  );
}
