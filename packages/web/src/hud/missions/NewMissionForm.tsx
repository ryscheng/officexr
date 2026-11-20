import { useRef, useState } from 'react';
import { Calendar, MapPin, Plus, X } from 'lucide-react';
import type { MissionPlace, MissionStep, NewMission } from '@officexr/sdk';
import { isComposing } from '../isComposing';
import { Button } from '../ui/Button';
import { FIELD } from '../ui/fieldStyles';
import { Keycap } from '../ui/Keycap';
import { Switch } from '../ui/Switch';
import { useEscapeLayer } from '../useEscapeLayer';
import { formatDue, initialOf, type PlaceAreas } from './missionRows';
import type { OfficePerson } from './useOfficeSpots';

type Picker = 'steps' | 'place' | 'due' | 'person' | null;

const CHIP_BASE =
  'inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold whitespace-nowrap pointer-coarse:min-h-11';
const CHIP_ADD = `${CHIP_BASE} border border-dashed border-hud-text-2/50 text-hud-text-2 hover:bg-hud-hover`;
const CHIP_SET = `${CHIP_BASE} bg-hud-accent/15 text-hud-accent`;
const LIST_ITEM = 'w-full rounded-lg px-3 py-1.5 text-left text-sm text-hud-text hover:bg-hud-hover pointer-coarse:min-h-11';

const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function NewMissionForm({
  areas,
  people,
  onAdd,
  onCancel,
  sheet = false,
}: {
  areas: PlaceAreas;
  people: readonly OfficePerson[];
  onAdd: (input: NewMission) => void;
  onCancel: () => void;
  sheet?: boolean;
}) {
  const [title, setTitle] = useState('');
  const [steps, setSteps] = useState<MissionStep[]>([]);
  const [stepDraft, setStepDraft] = useState('');
  const [place, setPlace] = useState<MissionPlace | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [person, setPerson] = useState<OfficePerson | null>(null);
  const [shared, setShared] = useState(false);
  const [picker, setPicker] = useState<Picker>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEscapeLayer(true, onCancel, () => rootRef.current);

  const toggle = (p: Exclude<Picker, null>) => setPicker((cur) => (cur === p ? null : p));
  const canAdd = title.trim().length > 0;
  const add = () => {
    if (!canAdd) {
      return;
    }
    onAdd({ title: title.trim(), steps, place, dueAt, personLogin: person?.login ?? null, shared });
  };
  const onTitleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isComposing(e.nativeEvent)) {
      e.preventDefault();
      add();
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
      autoFocus
      aria-label="Mission title"
      value={title}
      maxLength={140}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={onTitleKey}
      placeholder="What needs doing?"
      className={`${FIELD} min-w-0 flex-1 border-hud-accent/60 text-sm font-semibold ${sheet ? 'h-12 text-base' : ''}`}
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
          <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-hud-accent text-[10px] text-hud-on-accent">
            {initialOf(person.name)}
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
                  className="rounded-md p-1 text-hud-text-2 hover:bg-hud-hover pointer-coarse:min-h-11 pointer-coarse:min-w-11"
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
    <label className="flex items-center gap-2 text-xs text-hud-text">
      <Switch aria-label="Share with team" checked={shared} onCheckedChange={setShared} />
      <span className="font-semibold">Share{sheet ? '' : ' with team'}</span>
      {!sheet && <span className="text-hud-text-2">{shared ? 'on: the office sees it' : 'off: only you see it'}</span>}
    </label>
  );

  if (sheet) {
    return (
      <div data-no-hotkeys ref={rootRef} role="dialog" aria-label="New mission" className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-hud-text">
            New mission
            <span className="rounded-full bg-hud-accent/15 px-2 py-0.5 text-[11px] text-hud-accent">Mine</span>
          </h3>
          <button type="button" onClick={onCancel} className="min-h-11 px-3 text-sm font-semibold text-hud-accent">
            Cancel
          </button>
        </div>
        <div className="flex items-center gap-2">
          {titleField}
          <Button tone="primary" size="lg" className="h-12 min-w-24" disabled={!canAdd} onClick={add}>
            Add
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2">
          {chips}
          {shareRow}
        </div>
        {pickers}
      </div>
    );
  }

  return (
    <div data-no-hotkeys ref={rootRef} role="group" aria-label="New mission" className="flex flex-col gap-2.5 rounded-2xl border border-hud-hairline bg-hud-inset/60 p-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-hud-text-2 uppercase">
        New mission
        <span className="rounded-full bg-hud-accent/15 px-2 py-0.5 text-[11px] text-hud-accent normal-case">Mine</span>
      </div>
      {titleField}
      {chips}
      {pickers}
      {shareRow}
      <div className="flex items-center justify-between gap-2 border-t border-hud-separator pt-2.5">
        <span className="flex items-center gap-1 text-[11px] text-hud-text-2">
          <Keycap>Enter</Keycap> add · <Keycap>Esc</Keycap> cancel
        </span>
        <span className="flex items-center gap-2">
          <Button size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button tone="primary" size="sm" disabled={!canAdd} onClick={add}>
            Add
          </Button>
        </span>
      </div>
    </div>
  );
}
