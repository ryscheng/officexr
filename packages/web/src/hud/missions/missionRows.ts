import { MISSION_SOURCES, type Mission, type MissionPlace, type MissionSource } from '@officexr/sdk';

export type MissionTab = 'mine' | 'team';
export type SourceFilter = 'all' | MissionSource;

export const SOURCE_LABEL: Record<MissionSource, string> = {
  mine: 'Mine',
  artio: 'Artio',
  linear: 'Linear',
  github: 'GitHub',
  calendar: 'Calendar',
  slack: 'Slack',
};

export type Area = { id: string; label: string; min: { x: number; z: number }; max: { x: number; z: number } };
export type PlaceAreas = { rooms: readonly Area[]; desks: readonly Area[] };
export type Spot = { x: number; z: number };

export const isMine = (m: Mission, me: string) => m.ownerLogin === me;

export function tabMissions(missions: readonly Mission[], me: string, tab: MissionTab): Mission[] {
  return missions.filter((m) => (tab === 'mine' ? isMine(m, me) : m.shared && !isMine(m, me)));
}

export function sourceChips(missions: readonly Mission[]): SourceFilter[] {
  const present = new Set(missions.map((m) => m.source));
  return ['all', 'mine', ...MISSION_SOURCES.filter((s) => s !== 'mine' && present.has(s))];
}

export function filterBySource(missions: readonly Mission[], source: SourceFilter): Mission[] {
  return source === 'all' ? [...missions] : missions.filter((m) => m.source === source);
}

const dueTime = (m: Mission) => (m.dueAt ? Date.parse(m.dueAt) : Number.POSITIVE_INFINITY);

export function orderMissions(missions: readonly Mission[], currentId: string | null): Mission[] {
  const rank = (m: Mission) => (m.done ? 2 : m.id === currentId ? 0 : 1);
  return [...missions].sort(
    (a, b) => rank(a) - rank(b) || dueTime(a) - dueTime(b) || Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function todayProgress(missions: readonly Mission[], now: Date): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const m of missions) {
    if (m.done) {
      if (sameDay(new Date(m.updatedAt), now)) {
        done++;
        total++;
      }
    } else if (!m.dueAt || new Date(m.dueAt) <= endOfDay(now)) {
      total++;
    }
  }
  return { done, total };
}

const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

export function formatDue(dueAt: string, now: Date): string {
  const d = new Date(dueAt);
  return sameDay(d, now) ? time(d) : `${d.toLocaleDateString([], { weekday: 'short' })} ${time(d)}`;
}

export const formatDoneAt = (updatedAt: string) => time(new Date(updatedAt));

export function stepsLabel(m: Mission): string | null {
  return m.steps.length ? `${m.steps.filter((s) => s.done).length} of ${m.steps.length} steps` : null;
}

export function metaLine(m: Mission, now: Date, withSteps = false): string {
  if (m.done) {
    return `Complete · ${formatDoneAt(m.updatedAt)}`;
  }
  const steps = withSteps && m.steps.length ? `${m.steps.filter((s) => s.done).length} of ${m.steps.length}` : null;
  return [m.place?.label, m.dueAt ? `Due ${formatDue(m.dueAt, now)}` : null, steps].filter(Boolean).join(' · ');
}

export function resolvePlace(place: MissionPlace, areas: PlaceAreas): Spot | null {
  const area = (place.kind === 'room' ? areas.rooms : areas.desks).find((a) => a.id === place.id);
  return area ? { x: (area.min.x + area.max.x) / 2, z: (area.min.z + area.max.z) / 2 } : null;
}

/** Rooms are the map's voice zones that are not desks. */
export function placeAreas(zones: readonly Area[], desks: readonly Area[]): PlaceAreas {
  const deskIds = new Set(desks.map((d) => d.id));
  return { rooms: zones.filter((z) => !deskIds.has(z.id)), desks };
}

export const distanceBetween = (a: Spot, b: Spot) => Math.hypot(a.x - b.x, a.z - b.z);

export type MissionSpot = { id: string; spot: Spot };

export function missionSpots(missions: readonly Mission[], areas: PlaceAreas): MissionSpot[] {
  return missions.flatMap((m) => {
    const spot = m.place ? resolvePlace(m.place, areas) : null;
    return spot ? [{ id: m.id, spot }] : [];
  });
}

export function distancesFrom(spots: readonly MissionSpot[], self: Spot | null): Map<string, number> {
  return new Map(self ? spots.map(({ id, spot }) => [id, Math.floor(distanceBetween(self, spot))]) : []);
}

export const missionDistances = (missions: readonly Mission[], areas: PlaceAreas, self: Spot | null) =>
  distancesFrom(missionSpots(missions, areas), self);

export const sameDistances = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) =>
  a.size === b.size && [...a].every(([id, d]) => b.get(id) === d);

export const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || '?';
