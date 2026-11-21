import { CheckCircle2 } from "lucide-react";
import { Button } from "../ui/Button";
import type { MissionCue } from "./useMissionCue";

export function MissionCueToast({
  cue,
  onUndo,
}: {
  cue: MissionCue;
  onUndo: () => void;
}) {
  return (
    <div
      role="status"
      className={`pointer-events-auto flex w-max max-w-full shrink-0 items-center gap-2 rounded-hud-control hud-glass border border-hud-edge py-1 pr-1 pl-3 font-hud-body font-semibold text-hud-sage-text shadow-hud-control transition-opacity ease-out starting:opacity-0 ${
        cue.all ? "text-base duration-500" : "text-sm duration-200"
      }`}
    >
      <CheckCircle2
        aria-hidden
        className={`shrink-0 ${cue.all ? "size-5" : "size-4"}`}
      />
      <span className="line-clamp-2 min-w-0 break-words">
        {cue.all ? "All missions done" : `Done: ${cue.title}`}
      </span>
      <Button
        size="sm"
        className="ml-1 shrink-0 min-h-12 min-w-12"
        onClick={onUndo}
      >
        Undo
      </Button>
    </div>
  );
}
