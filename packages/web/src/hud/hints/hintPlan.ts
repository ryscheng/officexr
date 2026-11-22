import type { HintName } from '../hintFlags';

export const HINT_ORDER: readonly HintName[] = ['people', 'move', 'alone', 'build'];
export const HINT_SHOW_MS = 12_000;
export const HINT_GAP_MS = 3_000;
export const HINT_MIN_SEEN_MS = 2_000;
export const HINT_DELAY_MS: Record<HintName, number> = {
  people: 6_000,
  move: 10_000,
  alone: 60_000,
  build: 0,
};

export type ActiveHint = { name: HintName; at: number };

export type PlanInput = {
  now: number;
  active: ActiveHint | null;
  lastEndedAt: number | null;
  conditions: Record<HintName, boolean>;
  since: Partial<Record<HintName, number>>;
  isAvailable: (name: HintName) => boolean;
};

export function planHint({ now, active, lastEndedAt, conditions, since, isAvailable }: PlanInput): ActiveHint | null {
  if (active) {
    return conditions[active.name] && now - active.at < HINT_SHOW_MS ? active : null;
  }
  if (lastEndedAt !== null && now - lastEndedAt < HINT_GAP_MS) {
    return null;
  }
  const name = HINT_ORDER.find((n) => {
    const from = since[n];
    return conditions[n] && from !== undefined && now - from >= HINT_DELAY_MS[n] && isAvailable(n);
  });
  return name ? { name, at: now } : null;
}
