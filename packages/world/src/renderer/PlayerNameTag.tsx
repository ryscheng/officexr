import { useEffect, useState } from 'react';
import type { PlayerId, PlayerState, Store } from '@officexr/sdk';
import './PlayerNameTag.css';

export const shouldShowNameTag = (
  name: string,
  isSelf: boolean,
  paused: boolean,
): boolean => !isSelf && !paused && name !== '';

export function usePlayerName(store: Store, playerId: PlayerId): string {
  const [name, setName] = useState(() => store.getState().players[playerId]?.name ?? '');
  useEffect(
    () => store.subscribe((s) => s.players[playerId]?.name ?? '', setName),
    [store, playerId],
  );
  return name;
}

export type PlayerStatusTag = { statusText: string; statusEmoji: string; focus: boolean };

export const statusTagOf = (p: Pick<PlayerState, 'statusText' | 'statusEmoji' | 'focus'> | undefined): PlayerStatusTag => ({
  statusText: p?.statusText ?? '',
  statusEmoji: p?.statusEmoji ?? '',
  focus: p?.focus ?? false,
});

const sameStatusTag = (a: PlayerStatusTag, b: PlayerStatusTag) =>
  a.statusText === b.statusText && a.statusEmoji === b.statusEmoji && a.focus === b.focus;

export function usePlayerStatusTag(store: Store, playerId: PlayerId): PlayerStatusTag {
  const [tag, setTag] = useState(() => statusTagOf(store.getState().players[playerId]));
  useEffect(
    () => store.subscribe((s) => statusTagOf(s.players[playerId]), setTag, sameStatusTag),
    [store, playerId],
  );
  return tag;
}

export function FocusIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      role="img"
      aria-label="In focus mode"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8.7 3A6 6 0 0 1 18 8c0 2.4.5 4.3 1.2 5.7" />
      <path d="M17 17H3s3-2 3-9c0-.7.1-1.3.3-1.9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

/** The name and status label; `PlayerOverhead` places it above the head. */
export function PlayerNameTag(props: {
  store: Store;
  playerId: string;
  isSelf: boolean;
  paused: boolean;
}) {
  const { store, playerId, isSelf, paused } = props;
  const name = usePlayerName(store, playerId);
  const { statusText, statusEmoji, focus } = usePlayerStatusTag(store, playerId);
  if (!shouldShowNameTag(name, isSelf, paused)) return null;
  return (
    <div className="player-name-tag" data-focus={focus || undefined}>
      <div className="player-name-tag-name">
        {focus && <FocusIcon />}
        {statusEmoji && <span aria-hidden>{statusEmoji}</span>}
        <span>{name}</span>
      </div>
      {statusText && <div className="player-name-tag-status">{statusText}</div>}
    </div>
  );
}
