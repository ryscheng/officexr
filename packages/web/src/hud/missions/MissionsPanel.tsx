import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus } from 'lucide-react';
import type { NewMission } from '@officexr/sdk';
import { useFold } from '../foldPrefs';
import { Keycap } from '../ui/Keycap';
import { FoldablePanel } from '../ui/FoldablePanel';
import { Panel } from '../ui/Panel';
import { Tab, TabList, Tabs } from '../ui/Tabs';
import { useHotkey } from '../useHotkey';
import { MissionRow } from './MissionRow';
import {
  distanceBetween,
  filterBySource,
  isMine,
  orderMissions,
  resolvePlace,
  SOURCE_LABEL,
  sourceChips,
  tabMissions,
  todayProgress,
  type MissionTab,
  type PlaceAreas,
  type SourceFilter,
  type Spot,
} from './missionRows';
import { NewMissionForm } from './NewMissionForm';
import type { MissionsApi } from './useMissions';
import type { OfficePerson } from './useOfficeSpots';

const chipClass = (active: boolean) =>
  `rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap pointer-coarse:min-h-11 ${
    active ? 'bg-hud-text text-hud-panel-solid' : 'bg-hud-inset text-hud-text hover:bg-hud-hover'
  }`;

export type MissionsPanelProps = {
  missions: MissionsApi;
  me: string;
  areas: PlaceAreas;
  people: readonly OfficePerson[];
  self: Spot | null;
  compact?: boolean;
  now?: () => Date;
};

export function MissionsPanel({ missions: api, me, areas, people, self, compact = false, now = () => new Date() }: MissionsPanelProps) {
  const [tab, setTab] = useState<MissionTab>('mine');
  const [source, setSource] = useState<SourceFilter>('all');
  const fold = useFold('missions', compact);
  const [adding, setAdding] = useState(false);
  const clock = now();
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

  const add = async (input: NewMission) => {
    setAdding(false);
    await api.create(input);
  };

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

  return (
    <FoldablePanel
      fold={fold}
      title="Missions"
      label="missions"
      titleClassName="text-base"
      headerExtra={header}
      className={`pointer-events-auto flex max-w-[calc(100vw-24px)] flex-col gap-2 p-3 text-sm pointer-coarse:w-72 pointer-coarse:max-h-[calc(100dvh-104px)] pointer-coarse:portrait:max-h-[calc(100dvh-300px)] pointer-coarse:portrait:w-[calc(100vw-24px)] pointer-coarse:gap-1 pointer-coarse:p-2 ${folded && !compact ? 'w-60' : 'w-93'}`}
    >
      {unsupported && (
        <p role="status" className="rounded-hud-control border border-dashed border-hud-edge bg-hud-inset px-3 py-2 text-xs text-hud-text-2">
          Missions need a server update.
        </p>
      )}

      {!unsupported && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto" role="group" aria-label="Source">
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

      {(api.error || api.status === 'error') && (
        <p role="status" className="text-xs text-hud-rose-text">
          {api.error ?? 'Could not reach missions. Showing what we have.'}
        </p>
      )}

      {!unsupported && (
        <ul aria-label={tab === 'mine' ? 'My missions' : 'Team missions'} className="flex max-h-[40dvh] min-h-0 flex-col gap-0.5 pointer-coarse:max-h-none overflow-y-auto overscroll-contain">
          {rows.map((m) => {
            const spot = m.place ? resolvePlace(m.place, areas) : null;
            return (
              <MissionRow
                key={m.id}
                mission={m}
                compact={compact}
                current={api.current?.id === m.id}
                now={clock}
                canEdit={isMine(m, me)}
                distanceM={spot && self ? distanceBetween(self, spot) : null}
                personName={m.personLogin ? (names.get(m.personLogin) ?? m.personLogin) : null}
                onToggleDone={() => void api.update(m.id, { done: !m.done })}
                onToggleStep={(i) => void api.update(m.id, { steps: m.steps.map((s, j) => (j === i ? { ...s, done: !s.done } : s)) })}
                onGo={() => api.setCurrent(api.current?.id === m.id ? null : m.id)}
              />
            );
          })}
          {rows.length === 0 && (
            <li className="px-2 py-3 text-xs text-hud-text-2">
              {tab === 'mine' ? 'No missions yet. Press T to add one.' : 'Nobody has shared a mission yet.'}
            </li>
          )}
        </ul>
      )}

      {!unsupported && tab === 'mine' && !(adding && !compact) && (
        <button
          type="button"
          onClick={open}
          className="flex min-h-10 shrink-0 items-center gap-3 border-t border-hud-separator px-3 pt-2 text-sm text-hud-text-2 hover:text-hud-text pointer-coarse:min-h-11"
        >
          <Plus aria-hidden className="size-4" />
          <span>New mission</span>
          <span className="ml-auto">
            <Keycap>T</Keycap>
          </span>
        </button>
      )}
      {adding && !compact && !unsupported && (
        <NewMissionForm areas={areas} people={people} onAdd={(i) => void add(i)} onCancel={() => setAdding(false)} />
      )}
      {adding &&
        compact &&
        createPortal(
          <Panel material="thick" data-hud-modal className="pointer-events-auto fixed right-(--hud-inset-right) bottom-0 left-(--hud-inset-left) z-40 max-h-[85dvh] overflow-y-auto rounded-b-none p-3 pb-[max(0.75rem,var(--hud-safe-bottom))]">
            <NewMissionForm sheet areas={areas} people={people} onAdd={(i) => void add(i)} onCancel={() => setAdding(false)} />
          </Panel>,
          document.body,
        )}

      {!unsupported && (
        <p className="shrink-0 text-[11px] text-hud-text-2">
          {openCount} open · {mine.length - openCount} done
        </p>
      )}
    </FoldablePanel>
  );
}
