import { presenceIndicator, type PresenceIndicator } from '@officexr/sdk';
import { formatDistance } from './formatDistance';
import type { PresenceRow } from './presenceRows';
import { PRESENCE_INDICATOR } from './presenceColours';
import { relativeTime } from './relativeTime';

const IDLE_SHOWN_MS = 60_000;

export type PersonStatus = { word: string; dot: string; indicator: PresenceIndicator | null };

export function personStatus(row: PresenceRow, now: number): PersonStatus {
  if (row.type === 'departed') {
    return { word: 'Left', dot: 'bg-hud-text-2', indicator: null };
  }
  const indicator = row.type === 'self' ? row.status : presenceIndicator(row, now);
  return { word: PRESENCE_INDICATOR[indicator].label, dot: PRESENCE_INDICATOR[indicator].dot, indicator };
}

export function statusLine(row: PresenceRow, now: number, muted: boolean): string {
  const parts = [personStatus(row, now).word];
  if (row.type === 'peer') {
    const idleMs = row.lastActiveAt === undefined ? 0 : now - row.lastActiveAt;
    if (idleMs >= IDLE_SHOWN_MS) {
      parts.push(`Active ${relativeTime(idleMs)}`);
    }
    if (row.distanceM !== null) {
      parts.push(formatDistance(row.distanceM));
    }
  }
  if (muted) {
    parts.push('Muted');
  }
  return parts.join(' · ');
}

export const firstName = (name: string) => name.trim().split(' ')[0] || name;
