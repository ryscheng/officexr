import { useCallback, useId, useLayoutEffect, useRef } from 'react';
import type { OfficeState, PlayerId, PlayerState, Store } from '@officexr/sdk';
import { PRESENCE_INDICATOR } from './presenceColours';
import { headingDegrees } from './mapGeometry';
import { usePlayerPortrait, useSelfPortrait } from './playerPortrait';
import type { Spot } from './missions/missionRows';

const selectSelf = (s: OfficeState): PlayerState | undefined => s.players[s.selfId];

const fixed = (n: number) => Math.round(n * 100) / 100;

function useSelfPose(store: Store, apply: (me: PlayerState | undefined) => void) {
  useLayoutEffect(() => {
    apply(selectSelf(store.getState()));
    return store.subscribe(selectSelf, apply);
  }, [store, apply]);
}

function Portrait({ src, initial, radius }: { src: string | null; initial: string; radius: number }) {
  const clipId = useId();
  return (
    <>
      <circle r={radius} className="fill-hud-avatar" />
      {src ? (
        <>
          <clipPath id={clipId}>
            <circle r={radius} />
          </clipPath>
          <image href={src} x={-radius} y={-radius} width={radius * 2} height={radius * 2} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />
        </>
      ) : (
        <text y={1} textAnchor="middle" dominantBaseline="central" fontSize={radius * 1.1} fontWeight={700} className="fill-hud-text">
          {initial}
        </text>
      )}
    </>
  );
}

const PEER_R = 14;
const NAME_MAX = 14;

const firstName = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.length > NAME_MAX ? `${first.slice(0, NAME_MAX - 1)}…` : first;
};

export type PeerMarkerData = { id: PlayerId; name: string; x: number; z: number; yaw: number; presence: keyof typeof PRESENCE_INDICATOR };

export function PeerMarker({ peer, scale, size, named }: { peer: PeerMarkerData; scale: number; size: number; named: boolean }) {
  const portrait = usePlayerPortrait(peer.id);
  const colour = PRESENCE_INDICATOR[peer.presence];
  const label = peer.name || 'Joining';
  return (
    <g role="img" aria-label={label} transform={`translate(${peer.x} ${peer.z}) scale(${scale * size})`}>
      <title>{label}</title>
      <g transform={`rotate(${headingDegrees(peer.yaw)})`}>
        <path d="M0 -23L5.5 -16.5L-5.5 -16.5Z" strokeWidth={1.5} strokeLinejoin="round" className={`${colour.fill} stroke-hud-contrast`} />
      </g>
      <circle r={PEER_R + 1.5} strokeWidth={3} className={`fill-hud-contrast ${colour.stroke}`} />
      <Portrait src={portrait} initial={label.charAt(0).toUpperCase()} radius={PEER_R - 1} />
      {named && peer.name && (
        <text y={PEER_R + 14} textAnchor="middle" fontSize={12 / size} fontWeight={600} strokeWidth={3.5} strokeLinejoin="round" paintOrder="stroke" className="fill-hud-text stroke-map-floor">
          {firstName(peer.name)}
        </text>
      )}
    </g>
  );
}

const SELF_R = 16;
const WEDGE = 'M0 0L-17 -42Q0 -50 17 -42Z';

export function SelfMarker({ store, scale, size }: { store: Store; scale: number; size: number }) {
  const portrait = useSelfPortrait();
  const placeRef = useRef<SVGGElement>(null);
  const turnRef = useRef<SVGGElement>(null);
  const apply = useCallback(
    (me: PlayerState | undefined) => {
      placeRef.current?.setAttribute('visibility', me ? 'visible' : 'hidden');
      if (me) {
        placeRef.current?.setAttribute('transform', `translate(${fixed(me.pos.x)} ${fixed(me.pos.z)}) scale(${scale * size})`);
        turnRef.current?.setAttribute('transform', `rotate(${fixed(headingDegrees(me.yaw))})`);
      }
    },
    [scale, size],
  );
  useSelfPose(store, apply);
  return (
    <g ref={placeRef} role="img" aria-label="You" visibility="hidden">
      <title>You</title>
      <g ref={turnRef} data-heading>
        <path d={WEDGE} className="fill-hud-accent/30" />
      </g>
      <circle r={SELF_R + 3} className="fill-hud-accent/25" />
      <circle r={SELF_R + 1.5} strokeWidth={3.5} className="fill-hud-contrast stroke-hud-accent" />
      <Portrait src={portrait} initial="You" radius={SELF_R - 1} />
    </g>
  );
}

const DOTS = '0.1 8';

export function SelfTrail({ store, tail }: { store: Store; tail: readonly Spot[] }) {
  const haloRef = useRef<SVGPolylineElement>(null);
  const lineRef = useRef<SVGPolylineElement>(null);
  const apply = useCallback(
    (me: PlayerState | undefined) => {
      const points = me ? [me.pos, ...tail].map((p) => `${fixed(p.x)},${fixed(p.z)}`).join(' ') : '';
      haloRef.current?.setAttribute('points', points);
      lineRef.current?.setAttribute('points', points);
    },
    [tail],
  );
  useSelfPose(store, apply);
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={DOTS} className="pointer-events-none">
      <polyline ref={haloRef} strokeWidth={8} className="stroke-hud-contrast/80" />
      <polyline ref={lineRef} strokeWidth={4} className="stroke-hud-accent" />
    </g>
  );
}
