import { useCallback, useEffect, useRef, useState } from "react";
import type { Mission } from "@officexr/sdk";
import type { MissionsApi } from "./useMissions";

export const CUE_MS = 5000;

export type MissionCue = { id: string; title: string; all: boolean };

export function useMissionCue(
  api: Pick<MissionsApi, "update">,
  mine: readonly Mission[],
  tick: () => void,
  onDone?: (id: string) => void,
) {
  const [cue, setCue] = useState<MissionCue | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setCue(null);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const toggle = async (mission: Mission) => {
    if (mission.done) {
      if (cue?.id === mission.id) {
        dismiss();
      }
      await api.update(mission.id, { done: false });
      return;
    }
    if (!(await api.update(mission.id, { done: true }))) {
      return;
    }
    tick();
    onDone?.(mission.id);
    clearTimeout(timer.current);
    setCue({
      id: mission.id,
      title: mission.title,
      all: mine.every((m) => m.done || m.id === mission.id),
    });
    timer.current = setTimeout(() => setCue(null), CUE_MS);
  };

  const undo = async () => {
    if (!cue) {
      return;
    }
    const { id } = cue;
    dismiss();
    await api.update(id, { done: false });
  };

  return { cue, toggle, undo };
}
