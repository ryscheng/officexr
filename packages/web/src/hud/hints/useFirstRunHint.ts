import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isHintAvailable, markHintDone, recordHintShown, type HintName } from '../hintFlags';
import { useNow } from '../useNow';
import { HINT_MIN_SEEN_MS, HINT_ORDER, planHint, type ActiveHint } from './hintPlan';

const TICK_MS = 500;

export type HintSignals = {
  coarse: boolean;
  canBuild: boolean;
  moving: boolean;
  headcount: number;
  nearName: string | null;
  menuOpen: boolean;
  otherSheetOpen: boolean;
  peopleOpen: boolean;
  mapOpen: boolean;
  building: boolean;
  inCall: boolean;
  toastShowing: boolean;
};

export function hintConditions(s: HintSignals): Record<HintName, boolean> {
  const free = !s.menuOpen && !s.otherSheetOpen && !s.toastShowing && !s.building;
  const quiet = free && !s.inCall;
  return {
    wave: free && s.nearName !== null,
    people: quiet && s.headcount > 1 && s.nearName === null,
    move: quiet,
    alone: quiet && s.headcount === 1 && s.nearName === null,
    build: !s.coarse && s.canBuild && s.menuOpen && !s.otherSheetOpen && !s.building,
  };
}

export function useFirstRunHint(signals: HintSignals): { hint: HintName | null; done: (name: HintName) => void } {
  const now = useNow(TICK_MS);
  const [active, setActive] = useState<ActiveHint | null>(null);
  const activeRef = useRef<ActiveHint | null>(null);
  const since = useRef<Partial<Record<HintName, number>>>({});
  const lastEndedAt = useRef<number | null>(null);
  const { coarse, canBuild, moving, headcount, nearName, menuOpen, otherSheetOpen, peopleOpen, mapOpen, building, inCall, toastShowing } = signals;
  const conditions = useMemo(
    () => hintConditions({ coarse, canBuild, moving, headcount, nearName, menuOpen, otherSheetOpen, peopleOpen, mapOpen, building, inCall, toastShowing }),
    [coarse, canBuild, moving, headcount, nearName, menuOpen, otherSheetOpen, peopleOpen, mapOpen, building, inCall, toastShowing],
  );

  const settle = useCallback((next: ActiveHint | null, at: number, counts = true) => {
    const current = activeRef.current;
    if (current?.name === next?.name) {
      return;
    }
    if (current) {
      lastEndedAt.current = at;
      if (counts && at - current.at >= HINT_MIN_SEEN_MS) {
        recordHintShown(current.name);
      }
    }
    activeRef.current = next;
    setActive(next);
  }, []);

  useEffect(() => {
    for (const name of HINT_ORDER) {
      if (conditions[name]) {
        since.current[name] ??= now;
      } else {
        delete since.current[name];
      }
    }
    settle(planHint({ now, active: activeRef.current, lastEndedAt: lastEndedAt.current, conditions, since: since.current, isAvailable: isHintAvailable }), now);
  }, [now, conditions, settle]);

  const done = useCallback(
    (name: HintName) => {
      markHintDone(name);
      if (activeRef.current?.name === name) {
        settle(null, performance.now(), false);
      }
    },
    [settle],
  );

  useEffect(() => {
    if (moving) {
      done('move');
    }
  }, [moving, done]);
  useEffect(() => {
    if (peopleOpen) {
      done('people');
    }
  }, [peopleOpen, done]);
  useEffect(() => {
    if (mapOpen) {
      done('alone');
    }
  }, [mapOpen, done]);
  useEffect(() => {
    if (building) {
      done('build');
    }
  }, [building, done]);

  return { hint: active?.name ?? null, done };
}
