import { memo, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import type { Mission } from '@officexr/sdk';
import { formatDistance } from '../formatDistance';
import { PortraitFace } from '../PortraitFace';
import { useLoginPortrait } from '../playerPortrait';
import { initialOf, metaLine, SOURCE_LABEL, stepsLabel } from './missionRows';

export type MissionRowProps = {
  mission: Mission;
  compact: boolean;
  current: boolean;
  now: Date;
  canEdit: boolean;
  distanceM: number | null;
  personName: string | null;
  personLogin?: string | null;
  onToggleDone: (mission: Mission) => void;
  onToggleStep: (mission: Mission, index: number) => void;
  onGo: (mission: Mission) => void;
};

export const MissionRow = memo(function MissionRow({ mission, compact, current, now, canEdit, distanceM, personName, personLogin = null, onToggleDone, onToggleStep, onGo }: MissionRowProps) {
  const [open, setOpen] = useState(false);
  const portrait = useLoginPortrait(personLogin);
  const steps = compact ? null : stepsLabel(mission);
  const goable = mission.place !== null && !mission.done;
  const distance = distanceM === null ? null : formatDistance(distanceM);
  const meta = [metaLine(mission, now, compact), compact && goable ? distance : null].filter(Boolean).join(' · ');
  return (
    <li
      data-mission-id={mission.id}
      data-current={current || undefined}
      className={`flex flex-col rounded-xl ${current ? 'bg-hud-accent/15 shadow-[inset_3px_0_0_var(--color-hud-accent)]' : ''}`}
    >
      <div className="flex items-center gap-2.5 px-2 py-1.5">
        <button
          type="button"
          role="checkbox"
          aria-checked={mission.done}
          aria-label={`${mission.title}, done`}
          onClick={() => onToggleDone(mission)}
          className="flex size-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-hud-accent pointer-fine:size-8"
        >
          <span
            className={`flex size-6 items-center justify-center rounded-full border-2 transition-colors duration-200 ease-out ${mission.done ? 'border-hud-sage-text bg-hud-sage-text text-white' : 'border-hud-text-2/60'}`}
          >
            <Check
              aria-hidden
              className={`size-3.5 transition-[opacity,scale] duration-200 ease-out motion-reduce:transition-opacity ${mission.done ? 'opacity-100' : 'scale-50 opacity-0'}`}
              strokeWidth={3}
            />
          </span>
        </button>
        <button
          type="button"
          aria-expanded={mission.steps.length ? open : undefined}
          onClick={() => mission.steps.length && setOpen((o) => !o)}
          className="flex min-h-12 min-w-0 flex-1 flex-col items-start justify-center gap-0.5 text-left pointer-fine:min-h-0"
        >
          {current && <span className="text-[10px] font-bold tracking-wider text-hud-accent uppercase">Current</span>}
          <span className={`w-full text-sm font-semibold ${compact ? 'line-clamp-2 break-words' : 'truncate'} ${mission.done ? 'text-hud-text-2 line-through' : 'text-hud-text'}`}>{mission.title}</span>
          <span className="flex w-full items-center gap-1.5 text-xs text-hud-text-2">
            <span className="shrink-0 rounded-md border border-hud-hairline bg-hud-inset px-1.5 text-[10px] font-semibold text-hud-text">
              {SOURCE_LABEL[mission.source]}
            </span>
            <span className="truncate">{meta}</span>
          </span>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-hud-text-2">
          {goable ? (
            <>
              {distance && !compact && <span className="tabular-nums">{distance}</span>}
              <button
                type="button"
                aria-pressed={current}
                aria-label={`Go to ${mission.place?.label}`}
                onClick={() => onGo(mission)}
                className={`inline-flex min-h-8 items-center gap-1 rounded-full px-3.5 text-sm font-semibold pointer-coarse:min-h-12 ${
                  current ? 'bg-hud-accent-fill text-hud-on-accent' : 'bg-hud-inset text-hud-text hover:bg-hud-hover'
                }`}
              >
                Go <ArrowRight aria-hidden className="size-3.5" />
              </button>
            </>
          ) : (
            personName && (
              <span aria-label={personName} role="img" className="relative flex size-7 rounded-full bg-hud-avatar text-[11px] font-bold text-hud-text">
                <PortraitFace src={portrait} initial={initialOf(personName)} />
              </span>
            )
          )}
          {steps && !mission.done && <span className="tabular-nums">{steps}</span>}
        </div>
      </div>
      {open && (
        <ul aria-label="Steps" className="mb-1 ml-14 flex flex-col pr-3">
          {mission.steps.map((s, i) => (
            <li key={i}>
              <label className="flex min-h-8 items-center gap-2 text-xs text-hud-text pointer-coarse:min-h-12">
                <input type="checkbox" checked={s.done} disabled={!canEdit} onChange={() => onToggleStep(mission, i)} className="size-4 accent-hud-accent" />
                <span className={s.done ? 'text-hud-text-2 line-through' : ''}>{s.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
});
