export interface BusyInterval {
  start: string;
  end: string;
}

export interface CalendarStatus {
  busy: boolean;
  /** ISO instant: when the current busy block ends, when the next one starts, or the end of the window. */
  until: string;
}

export const STATUS_WINDOW_MS = 8 * 60 * 60 * 1000;

/** Merges overlapping and touching intervals, dropping any that are malformed or empty. */
function mergedBlocks(intervals: BusyInterval[]): [number, number][] {
  const parsed = intervals
    .map((i): [number, number] => [Date.parse(i.start), Date.parse(i.end)])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of parsed) {
    const last = merged.at(-1);
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/** Busy-until or free-until at `now`, from busy intervals within the next `windowMs`. Instants only, so no time zone is involved. */
export function calendarStatus(intervals: BusyInterval[], now: Date, windowMs = STATUS_WINDOW_MS): CalendarStatus {
  const at = now.getTime();
  const blocks = mergedBlocks(intervals);
  const current = blocks.find(([start, end]) => start <= at && at < end);
  if (current) {
    return { busy: true, until: new Date(current[1]).toISOString() };
  }
  const next = blocks.find(([start]) => start > at);
  return { busy: false, until: new Date(next ? Math.min(next[0], at + windowMs) : at + windowMs).toISOString() };
}
