const KEY = 'officexr:visits';
const LANDED_KEY = 'officexr:landed';

type Visits = Record<string, string>;

export function readVisits(): Visits {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Visits) : {};
  } catch {
    return {};
  }
}

export function recordVisit(id: string, now = new Date()): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readVisits(), [id]: now.toISOString() }));
  } catch {
    return;
  }
}

export function lastVisitedId(visits: Visits): string | null {
  const [latest] = Object.entries(visits).sort(([, a], [, b]) => b.localeCompare(a));
  return latest?.[0] ?? null;
}

export function sortOffices<T extends { id: string; name: string }>(offices: T[], visits: Visits): T[] {
  return [...offices].sort((a, b) => (visits[b.id] ?? '').localeCompare(visits[a.id] ?? '') || a.name.localeCompare(b.name));
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function lastVisitedLabel(iso: string | undefined, now = new Date()): string | null {
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) {
    return null;
  }
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (days <= 0) {
    return 'Last visited today';
  }
  return days === 1 ? 'Last visited yesterday' : `Last visited ${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}

/** The first visit to the list in a browser tab may skip it; later ones ("Switch office") must not. */
export function canSkipList(): boolean {
  try {
    return sessionStorage.getItem(LANDED_KEY) === null;
  } catch {
    return false;
  }
}

export function markLanded(): void {
  try {
    sessionStorage.setItem(LANDED_KEY, '1');
  } catch {
    return;
  }
}
