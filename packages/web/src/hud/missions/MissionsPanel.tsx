import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, Plus, Target } from 'lucide-react';
import type { Mission, NewMission } from '@officexr/sdk';
import { useFold } from '../foldPrefs';
import { FoldablePanel } from '../ui/FoldablePanel';
import { PortraitSheet } from '../ui/PortraitSheet';
import { Button } from '../ui/Button';
import { CHIP } from '../ui/Panel';
import { Tab, TabList, Tabs } from '../ui/Tabs';
import { useHotkey } from '../useHotkey';
import { useStableCallback } from '../useStableCallback';
import { MissionCueToast } from './MissionCueToast';
import { MissionRow } from './MissionRow';
import { useClock } from './useClock';
import { playMissionTick } from './missionTick';
import { useMissionCue } from './useMissionCue';
import {
  filterBySource,
  isMine,
  orderMissions,
  SOURCE_LABEL,
  sourceChips,
  tabMissions,
  todayProgress,
  type MissionTab,
  type PlaceAreas,
  type SourceFilter,
} from './missionRows';
import { NewMissionForm } from './NewMissionForm';
import type { MissionsApi } from './useMissions';
import type { OfficePerson } from './useOfficeSpots';

const SHORT_SCREEN_PX = 700;

const chipClass = (active: boolean) =>
  `rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap pointer-coarse:min-h-12 pointer-coarse:min-w-12 ${
    active ? 'bg-hud-text text-hud-panel-solid' : 'bg-hud-inset text-hud-text hover:bg-hud-hover'
  }`;

export type MissionsPanelProps = {
  missions: MissionsApi;
  me: string;
  areas: PlaceAreas;
  people: readonly OfficePerson[];
  distances: ReadonlyMap<string, number>;
  compact?: boolean;
  portrait?: boolean;
  collapsed?: boolean;
  now?: () => Date;
  tick?: () => void;
  cueSlot?: HTMLElement | null;
};

export function MissionsPanel({
  missions: api,
  me,
  areas,
  people,
  distances,
  compact = false,
  portrait = false,
  collapsed = false,
  now = () => new Date(),
  tick = playMissionTick,
  cueSlot = null,
}: MissionsPanelProps) {
  const [tab, setTab] = useState<MissionTab>('mine');
  const [source, setSource] = useState<SourceFilter>('all');
  const fold = useFold('missions', compact);
  const [adding, setAdding] = useState(false);
  const [tall, setTall] = useState(() => window.innerHeight < SHORT_SCREEN_PX);
  const clock = useClock(now);
  const unsupported = api.status === 'unsupported';

  const mine = useMemo(() => tabMissions(api.missions, me, 'mine'), [api.missions, me]);
  const inTab = useMemo(() => tabMissions(api.missions, me, tab), [api.missions, me, tab]);
  const chips = useMemo(() => sourceChips(inTab), [inTab]);
  const activeSource = chips.includes(source) ? source : 'all';
  const rows = useMemo(
    () => orderMissions(filterBySource(inTab, activeSource), api.current?.id ?? null),
    [inTab, activeSource, api.current],
  );
  const progress = todayProgress(mine, clock);
  const names = useMemo(() => new Map(people.map((p) => [p.login, p.name])), [people]);

  const open = () => {
    fold.setFolded(false);
    setAdding(true);
  };
  useHotkey('t', open, !unsupported);

  const [focusId, setFocusId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (focusId && !adding) {
      listRef.current?.querySelector<HTMLElement>(`[data-mission-id="${focusId}"] button`)?.focus();
      setFocusId(null);
    }
  }, [focusId, adding, rows]);

  const save = async (input: NewMission) => {
    const created = await api.create(input);
    if (!created) {
      return false;
    }
    setFocusId(created.id);
    setAdding(false);
    return true;
  };

  const next = (doneId: string) => {
    if (api.current?.id === doneId) {
      api.setCurrent(rows.find((m) => m.id !== doneId && !m.done && m.place !== null)?.id ?? null);
    }
  };
  const { cue, toggle, undo } = useMissionCue(api, mine, tick, next);
  const onToggleDone = useStableCallback((m: Mission) => void toggle(m));
  const onToggleStep = useStableCallback(
    (m: Mission, i: number) => void api.update(m.id, { steps: m.steps.map((s, j) => (j === i ? { ...s, done: !s.done } : s)) }),
  );
  const onGo = useStableCallback((m: Mission) => api.setCurrent(api.current?.id === m.id ? null : m.id));
  const cueNode = cue && !adding && <MissionCueToast cue={cue} onUndo={() => void undo()} />;
  const cueInSlot = cueSlot !== null && cueNode && (portrait ? fold.folded : !compact);

  const openCount = mine.filter((m) => !m.done).length;
  const percent = progress.total ? (progress.done / progress.total) * 100 : 0;

  const folded = fold.folded;
  const header = (
    <>
      {compact && !unsupported && (
        <>
          <span aria-hidden className="ml-2 h-1.5 flex-1 overflow-hidden rounded-full bg-hud-track">
            <span className="block h-full rounded-full bg-hud-sage-text" style={{ width: `${percent}%` }} />
          </span>
          <span className="text-xs text-hud-text-2 tabular-nums">
            {progress.done}/{progress.total}
          </span>
        </>
      )}
      {!compact && folded && !unsupported && <span className="text-xs text-hud-text-2 tabular-nums">{openCount} open</span>}
      {!compact && !folded && !unsupported && (
        <Tabs value={tab} onValueChange={(v) => setTab(v as MissionTab)}>
          <TabList aria-label="Whose missions">
            <Tab value="mine">Mine</Tab>
            <Tab value="team">Team</Tab>
          </TabList>
        </Tabs>
      )}
    </>
  );

  const formNode =
    adding && !unsupported ? (
      compact ? (
        <PortraitSheet label="New mission" closeLabel="Close new mission" onClose={() => setAdding(false)}>
          <NewMissionForm sheet areas={areas} people={people} onSave={save} onCancel={() => setAdding(false)} />
        </PortraitSheet>
      ) : (
        <NewMissionForm areas={areas} people={people} onSave={save} onCancel={() => setAdding(false)} />
      )
    ) : null;

  const bodyNodes = formNode && !compact ? (
    formNode
  ) : (
    <>
      {unsupported && (
        <p role="status" className="rounded-hud-control border border-dashed border-hud-edge bg-hud-inset px-3 py-2 text-xs text-hud-text-2">
          Missions need a server update.
        </p>
      )}

      {!unsupported && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto pointer-coarse:gap-2" role="group" aria-label="Source">
          {chips.map((c) => (
            <button key={c} type="button" aria-pressed={c === activeSource} className={chipClass(c === activeSource)} onClick={() => setSource(c)}>
              {c === 'all' ? 'All' : SOURCE_LABEL[c]}
            </button>
          ))}
        </div>
      )}

      {!unsupported && !compact && (
        <div className="flex shrink-0 items-center gap-3 text-xs text-hud-text-2">
          <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-hud-track">
            <span className="block h-full rounded-full bg-hud-sage-text" style={{ width: `${percent}%` }} />
          </span>
          <span className="tabular-nums">
            {progress.done} of {progress.total} today
          </span>
        </div>
      )}

      {!adding && (api.error || api.status === 'error') && (
        <p role="status" className="text-xs text-hud-rose-text">
          {api.error ?? 'Could not reach missions. Showing what we have.'}
        </p>
      )}

      {!unsupported && (
        <ul
          ref={listRef}
          aria-label={tab === 'mine' ? 'My missions' : 'Team missions'}
          className="flex max-h-[40dvh] min-h-0 flex-col gap-0.5 pointer-coarse:max-h-none overflow-y-auto overscroll-contain"
        >
          {rows.map((m) => (
            <MissionRow
              key={m.id}
              mission={m}
              compact={compact}
              current={api.current?.id === m.id}
              now={clock}
              canEdit={isMine(m, me)}
              distanceM={distances.get(m.id) ?? null}
              personLogin={m.personLogin}
              personName={m.personLogin ? (names.get(m.personLogin) ?? m.personLogin) : null}
              onToggleDone={onToggleDone}
              onToggleStep={onToggleStep}
              onGo={onGo}
            />
          ))}
          {rows.length === 0 && (
            <li className="flex flex-col gap-1 px-2 py-3 text-xs text-hud-text-2">
              {tab === 'mine' ? (
                <>
                  <span>No missions yet. Add one and it shows up here.</span>
                  <span>You can also type /mission in chat.</span>
                </>
              ) : (
                'Nobody has shared a mission yet.'
              )}
            </li>
          )}
        </ul>
      )}

      {!unsupported && tab === 'mine' && (!cueNode || cueInSlot) && (
        <Button tone="primary" size="md" aria-keyshortcuts="T" onClick={open} className="min-h-12 shrink-0">
          <Plus aria-hidden className="size-4" />
          Add mission
        </Button>
      )}
      {!cueInSlot && cueNode}
      {formNode}

      {!unsupported && !compact && (
        <p className="shrink-0 text-[11px] text-hud-text-2">
          {openCount} open · {mine.length - openCount} done
        </p>
      )}
    </>
  );

  const tabs = !unsupported && (
    <Tabs value={tab} onValueChange={(v) => setTab(v as MissionTab)}>
      <TabList aria-label="Whose missions">
        <Tab value="mine">Mine</Tab>
        <Tab value="team">Team</Tab>
      </TabList>
    </Tabs>
  );

  if (portrait) {
    if (folded) {
      return (
        <>
          <button
            type="button"
            aria-label="Expand missions"
            aria-expanded={false}
            onMouseDown={(e) => e.preventDefault()}
            onClick={fold.toggle}
            className="pointer-events-auto flex min-h-12 max-w-[60vw] items-center"
          >
            <span className={`flex h-10 max-w-full items-center gap-2 px-3 text-sm font-semibold ${CHIP} rounded-full`}>
              <Target aria-hidden className="size-4 shrink-0" />
              {!collapsed && <span className="min-w-0 truncate">{api.current?.title ?? 'Missions'}</span>}
              {!unsupported && (
                <span className="shrink-0 text-xs font-normal text-hud-text-2 tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              )}
            </span>
          </button>
          {cueInSlot ? createPortal(cueNode, cueSlot) : cueNode}
        </>
      );
    }
    if (formNode) {
      return formNode;
    }
    return (
      <PortraitSheet
        title="Missions"
        label="Missions"
        closeLabel="Collapse missions"
        onClose={fold.toggle}
        heightPct={tall ? 90 : 55}
        headerExtra={
          <button
            type="button"
            aria-label={tall ? 'Shrink missions' : 'Enlarge missions'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setTall((t) => !t)}
            className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-hud-text-2 hover:bg-hud-hover hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent"
          >
            {tall ? <Minimize2 aria-hidden className="size-4" /> : <Maximize2 aria-hidden className="size-4" />}
          </button>
        }
      >
        {tabs && <div className="flex shrink-0 justify-start pl-2">{tabs}</div>}
        {bodyNodes}
      </PortraitSheet>
    );
  }

  return (
    <>
      <FoldablePanel
        fold={fold}
        title="Missions"
        label="missions"
        titleClassName="text-base"
        headerExtra={header}
        className={`pointer-events-auto flex max-w-[calc(100vw-24px)] flex-col gap-2 p-3 text-sm pointer-coarse:w-72 pointer-coarse:max-h-[calc(100dvh-104px)] pointer-coarse:gap-1 pointer-coarse:p-2 ${folded && compact ? 'w-fit' : folded ? 'w-60' : 'w-93'}`}
      >
        {bodyNodes}
      </FoldablePanel>
      {cueInSlot && createPortal(cueNode, cueSlot)}
    </>
  );
}
