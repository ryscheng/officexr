import { useId, useState } from "react";
import { REPORT_NOTE_MAX, REPORT_REASONS, type ReportReason } from "@officexr/sdk";
import { Button } from "../hud/ui/Button";
import { InlineAlert } from "../hud/ui/InlineAlert";
import { FIELD } from "../hud/ui/fieldStyles";
import { useSocial } from "./SocialProvider";

const REASON_LABEL: Record<ReportReason, string> = {
  harassment: "Harassment or bullying",
  spam: "Spam",
  inappropriate: "Inappropriate content",
  impersonation: "Pretending to be someone else",
  other: "Something else",
};

type Phase = "form" | "sending" | "sent";

export function ReportForm({ login, name, onDone }: { login: string; name: string; onDone: () => void }) {
  const { report } = useSocial();
  const noteId = useId();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    if (!reason) {
      return;
    }
    setPhase("sending");
    setProblem(null);
    const outcome = await report(login, reason, note);
    if (outcome === "sent") {
      setPhase("sent");
      return;
    }
    setPhase("form");
    setProblem(outcome === "too-many" ? "You sent a report a moment ago. Wait a minute, then try again." : "The report did not send. Try again.");
  };
  if (phase === "sent") {
    return (
      <div className="flex min-h-0 flex-col gap-3 px-2 pb-1">
        <p role="status" className="text-base text-hud-text">
          Thank you. An admin will look at your report about {name}.
        </p>
        <Button tone="primary" className="min-h-12 w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <form
      className="flex min-h-0 flex-col gap-3 px-2 pb-1"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain">
        <fieldset className="flex flex-col gap-1">
          <legend className="pb-1 text-base font-semibold text-hud-text">Why are you reporting {name}?</legend>
          {REPORT_REASONS.map((value) => (
            <label key={value} className="flex min-h-10 cursor-pointer pointer-coarse:min-h-12 items-center gap-3 rounded-lg px-2 text-base text-hud-text hover:bg-hud-hover">
              <input type="radio" name="report-reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="size-5 accent-(--color-hud-accent-fill)" />
              {REASON_LABEL[value]}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1">
          <label htmlFor={noteId} className="text-sm text-hud-text-2">
            Add a note (optional)
          </label>
          <textarea id={noteId} value={note} maxLength={REPORT_NOTE_MAX} rows={3} onChange={(e) => setNote(e.target.value)} className={`${FIELD} resize-none text-base`} />
        </div>
        {problem && <InlineAlert>{problem}</InlineAlert>}
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-2">
        <Button className="min-h-12" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" tone="primary" className="min-h-12" disabled={!reason || phase === "sending"}>
          {phase === "sending" ? "Sending…" : "Send report"}
        </Button>
      </div>
    </form>
  );
}
