import { useId, useRef, useState } from 'react';
import { Calendar, ChevronDown, MapPin, Plus, X } from 'lucide-react';
import type { MissionPlace, MissionStep, NewMission } from '@officexr/sdk';
import { isComposing } from '../isComposing';
import { Button } from '../ui/Button';
import { FIELD } from '../ui/fieldStyles';
import { Switch } from '../ui/Switch';
import { useEscapeLayer } from '../useEscapeLayer';
import { PortraitFace } from '../PortraitFace';
import { usePlayerPortrait } from '../playerPortrait';
import { formatDue, initialOf, type PlaceAreas } from './missionRows';
import type { OfficePerson } from './useOfficeSpots';

type Picker = 'steps' | 'place' | 'due' | 'person' | null;

const CHIP_BASE =
  'inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold whitespace-nowrap pointer-coarse:min-h-12';
const CHIP_ADD = `${CHIP_BASE} border border-dashed border-hud-text-2/50 text-hud-text-2 hover:bg-hud-hover`;
const CHIP_SET = `${CHIP_BASE} bg-hud-accent/15 text-hud-accent`;
const LIST_ITEM = 'w-full rounded-lg px-3 py-1.5 text-left text-sm text-hud-text hover:bg-hud-hover pointer-coarse:min-h-12';

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function NewMissionForm({
  areas,
  people,
  onSave,
  onCancel,
  sheet = false,
}: {
  areas: PlaceAreas;
  people: readonly OfficePerson[];
  onSave: (input: NewMission) => Promise<boolean>;
  onCancel: () => void;
  sheet?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState<MissionStep[]>([]);
  const [stepDraft, setStepDraft] = useState('');
  const [place, setPlace] = useState<MissionPlace | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [person, setPerson] = useState<OfficePerson | null>(null);
  const personPortrait = usePlayerPortrait(person?.id ?? '');
  const [shared, setShared] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const moreId = useId();
  const cancel = () => {
    if (!saving) {
      onCancel();
    }
  };
  useEscapeLayer(true, cancel, () => rootRef.current);

  const toggle = (p: Exclude<Picker, null>) => setPicker((cur) => (cur === p ? null : p));
  const canSave = title.trim().length > 0 && !saving;
  const save = async () => {
    if (!canSave) {
      return;
    }
    setSaving(true);
    setFailed(false);
    const saved = await onSave({
      title: title.trim(),
      steps,
      place,
      dueAt,
      personLogin: person?.login ?? null,
      shared,
    });
    if (!saved) {
      setSaving(false);
      setFailed(true);
    }
  };
  const onTitleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isComposing(e.nativeEvent)) {
      e.preventDefault();
      void save();
    }
  };
  const addStep = () => {
    const text = stepDraft.trim();
    if (text) {
      setSteps((s) => [...s, { text: text.slice(0, 140), done: false }]);
      setStepDraft('');
    }
  };

  const titleField = (
    <input
      id={titleId}
      autoFocus
      required
      aria-required
      value={title}
      maxLength={140}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={onTitleKey}
      placeholder="What do you want to do?"
      className={`${FIELD} min-w-0 border-hud-accent/60 text-sm font-semibold pointer-coarse:h-12 pointer-coarse:text-base`}
    />
  );

  const chips = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={steps.length ? CHIP_SET : CHIP_ADD} onClick={() => toggle('steps')}>
        <Plus aria-hidden className="size-3.5" />
        {steps.length ? `${steps.length} steps` : 'Steps'}
      </button>
      {place ? (
        <button type="button" className={CHIP_SET} aria-label={`Remove place ${place.label}`} onClick={() => setPlace(null)}>
          <MapPin aria-hidden className="size-3.5" />
          {place.label}
          <X aria-hidden className="size-3" />
        </button>
      ) : (
        <button type="button" className={CHIP_ADD} onClick={() => toggle('place')}>
          <Plus aria-hidden className="size-3.5" />
          Place
        </button>
      )}
      {dueAt ? (
        <button type="button" className={CHIP_SET} aria-label="Remove due time" onClick={() => setDueAt(null)}>
          <Calendar aria-hidden className="size-3.5" />
          {formatDue(dueAt, new Date())}
          <X aria-hidden className="size-3" />
        </button>
      ) : (
        <button type="button" className={CHIP_ADD} onClick={() => toggle('due')}>
          <Plus aria-hidden className="size-3.5" />
          Due
        </button>
      )}
      {person ? (
        <button type="button" className={CHIP_SET} aria-label={`Remove person ${person.name}`} onClick={() => setPerson(null)}>
          <span aria-hidden className="relative flex size-5 rounded-full bg-hud-accent text-[10px] text-hud-on-accent">
            <PortraitFace src={personPortrait} initial={initialOf(person.name)} />
          </span>
          {person.name}
          <X aria-hidden className="size-3" />
        </button>
      ) : (
        <button type="button" className={CHIP_ADD} onClick={() => toggle('person')}>
          <Plus aria-hidden className="size-3.5" />
          Person
        </button>
      )}
    </div>
  );

  const pickers = (
    <>
      {picker === 'steps' && (
        <div className="flex flex-col gap-1.5">
          <ul aria-label="Steps" className="flex flex-col gap-1">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{s.text}</span>
                <button
                  type="button"
                  aria-label={`Remove step ${s.text}`}
                  className="rounded-md p-1 text-hud-text-2 hover:bg-hud-hover pointer-coarse:min-h-12 pointer-coarse:min-w-12"
                  onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <input
            aria-label="New step"
            value={stepDraft}
            maxLength={140}
            onChange={(e) => setStepDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isComposing(e.nativeEvent)) {
                e.preventDefault();
                e.stopPropagation();
                addStep();
              }
            }}
            placeholder="Add a step, press Enter"
            className={`${FIELD} text-sm`}
          />
        </div>
      )}
      {picker === 'place' && (
        <ul aria-label="Places" className="max-h-36 overflow-y-auto">
          {[...areas.rooms.map((a) => ({ kind: 'room' as const, a })), ...areas.desks.map((a) => ({ kind: 'desk' as const, a }))].map(({ kind, a }) => (
            <li key={`${kind}:${a.id}`}>
              <button
                type="button"
                className={LIST_ITEM}
                onClick={() => {
                  setPlace({ kind, id: a.id, label: a.label });
                  setPicker(null);
                }}
              >
                {a.label} <span className="text-xs text-hud-text-2">{kind}</span>
              </button>
            </li>
          ))}
          {areas.rooms.length + areas.desks.length === 0 && <li className="px-3 py-1.5 text-sm text-hud-text-2">No rooms or desks in this office</li>}
        </ul>
      )}
      {picker === 'due' && (
        <input
          type="datetime-local"
          aria-label="Due"
          value={dueAt ? toLocalInput(dueAt) : ''}
          onChange={(e) => {
            if (e.target.value) {
              setDueAt(new Date(e.target.value).toISOString());
              setPicker(null);
            }
          }}
          className={`${FIELD} text-sm`}
        />
      )}
      {picker === 'person' && (
        <ul aria-label="People" className="max-h-36 overflow-y-auto">
          {people.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={LIST_ITEM}
                onClick={() => {
                  setPerson(p);
                  setPicker(null);
                }}
              >
                {p.name}
              </button>
            </li>
          ))}
          {people.length === 0 && <li className="px-3 py-1.5 text-sm text-hud-text-2">Nobody else is here</li>}
        </ul>
      )}
    </>
  );

  const shareRow = (
    <label className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-hud-text">
      <Switch aria-label="Share with team" checked={shared} onCheckedChange={setShared} />
      <span className="font-semibold whitespace-nowrap">Share with team</span>
      <span className="text-hud-text-2">{shared ? 'on: the office sees it' : 'off: only you see it'}</span>
    </label>
  );

  const fold = (
    <div className="flex flex-col gap-2.5">
      <button
        type="button"
        aria-expanded={more}
        aria-controls={moreId}
        onClick={() => setMore((m) => !m)}
        className="flex min-h-12 items-center gap-2 self-start rounded-lg px-1 text-sm font-semibold text-hud-text-2 hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent pointer-fine:min-h-8"
      >
        <ChevronDown aria-hidden className={`size-4 transition-transform motion-reduce:transition-none ${more ? 'rotate-180' : ''}`} />
        More: place, time, person, steps
      </button>
      {more && (
        <div id={moreId} className="flex flex-col gap-2.5">
          {chips}
          {pickers}
          {shareRow}
        </div>
      )}
    </div>
  );

  return (
    <div
      data-no-hotkeys
      ref={rootRef}
      role={sheet ? 'dialog' : 'group'}
      aria-label="New mission"
      className={`flex min-h-0 flex-col gap-2 ${sheet ? '' : 'rounded-2xl border border-hud-hairline bg-hud-inset/60 p-3'}`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-hud-text">
          New mission
          <span className="rounded-full bg-hud-accent/15 px-2 py-0.5 text-xs text-hud-accent">Mine</span>
        </div>
        <Button size="sm" disabled={saving} onClick={cancel}>
          Cancel
        </Button>
      </div>
      <div className="flex shrink-0 items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={titleId} className="text-xs font-semibold text-hud-text-2">
            Title
          </label>
          {titleField}
        </div>
        <Button tone="primary" size="sm" className="shrink-0 pointer-coarse:h-12" disabled={!canSave} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save mission'}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="shrink-0 text-xs font-semibold text-hud-rose-text">
          We could not save this mission. Try again.
        </p>
      )}
      <div className="min-h-0 overflow-y-auto overscroll-contain">{fold}</div>
    </div>
  );
}
