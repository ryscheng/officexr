// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Mission, MissionsClient } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryMissionsClient } from './inMemoryMissions';
import { MissionsUnsupportedError } from './missionsApi';
import { CUE_MS } from './useMissionCue';
import { MissionsPanel } from './MissionsPanel';
import { missionDistances, placeAreas } from './missionRows';
import { useMissions } from './useMissions';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const NOW = new Date(2026, 10, 20, 9, 0);
const at = (h: number, m: number) => new Date(2026, 10, 20, h, m).toISOString();
const base = { officeId: 'o', source: 'mine' as const, ownerLogin: 'me', personLogin: null, shared: false, done: false, createdAt: at(8, 0), updatedAt: at(8, 0) };
const ROOM = { kind: 'room' as const, id: 'r1', label: 'Meeting room 1' };

const SEED: Mission[] = [
  { ...base, id: 'a', title: 'Join the stand-up', steps: [], place: ROOM, dueAt: at(10, 0) },
  {
    ...base,
    id: 'b',
    title: 'Fix the redirect',
    steps: [
      { text: 'Reproduce', done: true },
      { text: 'Fix', done: false },
    ],
    place: null,
    dueAt: null,
  },
  { ...base, id: 'c', title: 'Ask about the demo', steps: [], place: null, dueAt: null, done: true, updatedAt: at(8, 45) },
  { ...base, id: 't', ownerLogin: 'bao', shared: true, title: 'Review the roadmap', steps: [], place: null, dueAt: null },
];

const AREAS = placeAreas([{ id: 'r1', label: 'Meeting room 1', min: { x: 10, z: 0 }, max: { x: 20, z: 10 } }], []);
const PEOPLE = [{ id: 'bao@x', login: 'bao@x', name: 'Bao Tran' }];

function Harness({ client, compact = false, portrait = false, collapsed = false, tick, cueSlot }: { client: MissionsClient; compact?: boolean; portrait?: boolean; collapsed?: boolean; tick?: () => void; cueSlot?: HTMLElement | null }) {
  const missions = useMissions(client, 'o');
  return <MissionsPanel missions={missions} me="me" areas={AREAS} people={PEOPLE} distances={missionDistances(missions.missions, AREAS, { x: 0, z: 5 })} compact={compact} portrait={portrait} collapsed={collapsed} now={() => NOW} tick={tick ?? (() => {})} cueSlot={cueSlot} />;
}

const setup = async (seed = SEED, compact = false) => {
  const client = createInMemoryMissionsClient('me', seed);
  render(<Harness client={client} compact={compact} />);
  await screen.findByRole('button', { name: /^(Collapse|Expand) missions$/ });
  if (!compact) {
    await screen.findByText(seed[0]!.title);
  }
  return client;
};

describe('MissionsPanel', () => {
  it('lists my missions with open ones first, done ones struck through at the end', async () => {
    await setup();
    const rows = within(screen.getByRole('list', { name: 'My missions' })).getAllByRole('listitem');
    const titles = rows.map((r) => within(r).getAllByRole('button')[0]?.textContent ?? '');
    expect(titles[0]).toContain('Join the stand-up');
    expect(titles.at(-1)).toContain('Ask about the demo');
    expect(screen.getByText('Ask about the demo').className).toContain('line-through');
    expect(screen.queryByText('Review the roadmap')).toBeNull();
  });

  it('shows place, due time and the distance to the place on a row with a place', async () => {
    await setup();
    expect(screen.getByText('Meeting room 1 · Due 10:00')).toBeTruthy();
    expect(screen.getByText('15 m')).toBeTruthy();
  });

  it('offers only All and Mine while no other source has missions', async () => {
    await setup();
    const chips = within(screen.getByRole('group', { name: 'Source' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['All', 'Mine']);
  });

  it('shows the progress as done of total today', async () => {
    await setup();
    expect(screen.getByText('1 of 3 today')).toBeTruthy();
  });

  it('Team shows what others shared', async () => {
    await setup();
    const team = screen.getByRole('tab', { name: 'Team' });
    fireEvent.mouseDown(team);
    fireEvent.click(team);
    expect(await screen.findByText('Review the roadmap')).toBeTruthy();
    expect(screen.queryByText('Join the stand-up')).toBeNull();
  });

  it('Go marks the mission current, and again clears it', async () => {
    await setup();
    const go = screen.getByRole('button', { name: 'Go to Meeting room 1' });
    fireEvent.click(go);
    expect(go.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Current')).toBeTruthy();
    fireEvent.click(go);
    expect(screen.queryByText('Current')).toBeNull();
  });

  it('the checkbox completes a mission', async () => {
    const client = await setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fix the redirect, done' }));
    await waitFor(async () => expect((await client.list('o')).find((m) => m.id === 'b')?.done).toBe(true));
  });

  it('says what to do in the empty state', async () => {
    render(<Harness client={createInMemoryMissionsClient('me', [])} />);
    await screen.findByText('No missions yet. Add one and it shows up here.');
    expect(screen.getByText('No missions yet. Add one and it shows up here.')).toBeTruthy();
    expect(screen.getByText('You can also type /mission in chat.')).toBeTruthy();
  });

  describe('completion cue', () => {
    const check = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name: `${name}, done` }));

    it('shows Done: title with Undo, plays the tick once and hides after 5 s', async () => {
      const tick = vi.fn();
      const client = createInMemoryMissionsClient('me', SEED);
      render(<Harness client={client} tick={tick} />);
      await screen.findByText('Join the stand-up');
      const timers = vi.spyOn(globalThis, 'setTimeout');
      check('Fix the redirect');
      const toast = await screen.findByText('Done: Fix the redirect');
      expect(toast.closest('[role="status"]')?.querySelector('button')?.textContent).toBe('Undo');
      expect(tick).toHaveBeenCalledTimes(1);
      const expire = timers.mock.calls.find(([, ms]) => ms === CUE_MS)?.[0] as () => void;
      timers.mockRestore();
      await act(async () => expire());
      expect(screen.queryByText('Done: Fix the redirect')).toBeNull();
    });

    it('Undo reopens the mission and hides the toast', async () => {
      const client = createInMemoryMissionsClient('me', SEED);
      render(<Harness client={client} tick={() => {}} />);
      await screen.findByText('Join the stand-up');
      check('Fix the redirect');
      fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
      await waitFor(async () => expect((await client.list('o')).find((m) => m.id === 'b')?.done).toBe(false));
      expect(screen.queryByText('Done: Fix the redirect')).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Fix the redirect, done' }).getAttribute('aria-checked')).toBe('false');
    });

    it('says All missions done when the last open mission is checked', async () => {
      const only: Mission[] = [SEED[0]!, SEED[2]!];
      const client = createInMemoryMissionsClient('me', only);
      render(<Harness client={client} tick={() => {}} />);
      await screen.findByText('Join the stand-up');
      check('Join the stand-up');
      expect(await screen.findByText('All missions done')).toBeTruthy();
      expect(screen.queryByText(/^Done:/)).toBeNull();
    });

    it('shows nothing and plays no tick when the update fails', async () => {
      const tick = vi.fn();
      const inner = createInMemoryMissionsClient('me', SEED);
      render(<Harness client={{ ...inner, update: () => Promise.reject(new Error('down')) }} tick={tick} />);
      await screen.findByText('Join the stand-up');
      check('Fix the redirect');
      await screen.findByText('Could not reach missions');
      expect(screen.queryByText(/^Done:/)).toBeNull();
      expect(tick).not.toHaveBeenCalled();
    });

    it('unchecking a done mission shows no toast and no tick', async () => {
      const tick = vi.fn();
      const client = createInMemoryMissionsClient('me', SEED);
      render(<Harness client={client} tick={tick} />);
      await screen.findByText('Join the stand-up');
      check('Ask about the demo');
      await waitFor(async () => expect((await client.list('o')).find((m) => m.id === 'c')?.done).toBe(false));
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
      expect(tick).not.toHaveBeenCalled();
    });

    it('moves the current mission to the next open one with a place', async () => {
      const seed: Mission[] = [SEED[0]!, { ...SEED[0]!, id: 'a2', title: 'Visit the kitchen', place: { kind: 'room', id: 'r1', label: 'Kitchen' } }];
      const client = createInMemoryMissionsClient('me', seed);
      render(<Harness client={client} tick={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Go to Meeting room 1' }));
      check('Join the stand-up');
      await screen.findByText('Done: Join the stand-up');
      expect(screen.getByRole('button', { name: 'Go to Kitchen' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('shows in the toast slot when the panel is folded', async () => {
      const slot = document.createElement('div');
      document.body.append(slot);
      const client = createInMemoryMissionsClient('me', SEED);
      render(<Harness client={client} compact portrait tick={() => {}} cueSlot={slot} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Expand missions' }));
      check('Fix the redirect');
      await screen.findByText('Done: Fix the redirect');
      expect(slot.textContent).toBe('');
      fireEvent.click(screen.getByRole('button', { name: 'Collapse missions' }));
      expect(slot.textContent).toContain('Done: Fix the redirect');
      slot.remove();
    });

    it('goes to the toast slot instead of the panel on desktop and landscape', async () => {
      const slot = document.createElement('div');
      document.body.append(slot);
      const client = createInMemoryMissionsClient('me', SEED);
      render(<Harness client={client} tick={() => {}} cueSlot={slot} />);
      await screen.findByText('Join the stand-up');
      check('Fix the redirect');
      await waitFor(() => expect(slot.textContent).toContain('Done: Fix the redirect'));
      expect(screen.getAllByText('Done: Fix the redirect')).toHaveLength(1);
      slot.remove();
    });

    it('shows under the chip in portrait while the sheet is folded', async () => {
      const client = createInMemoryMissionsClient('me', SEED);
      render(<Harness client={client} compact portrait tick={() => {}} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Expand missions' }));
      check('Fix the redirect');
      await screen.findByText('Done: Fix the redirect');
      fireEvent.click(screen.getByRole('button', { name: 'Collapse missions' }));
      expect(screen.getByRole('button', { name: 'Expand missions' })).toBeTruthy();
      expect(screen.getByText('Done: Fix the redirect')).toBeTruthy();
    });
  });

  it('opening a mission with steps lets the owner tick a step', async () => {
    const client = await setup();
    fireEvent.click(screen.getByRole('button', { name: /Fix the redirect/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fix' }));
    await waitFor(async () => expect((await client.list('o')).find((m) => m.id === 'b')?.steps[1]?.done).toBe(true));
  });

  it('collapses to the header and expands again', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse missions' }));
    expect(screen.queryByText('Join the stand-up')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand missions' }));
    expect(screen.getByText('Join the stand-up')).toBeTruthy();
  });

  describe('new mission', () => {
    const open = async () => {
      const client = await setup();
      fireEvent.click(screen.getByRole('button', { name: /Add mission/ }));
      return client;
    };

    it('Enter adds a mission owned by me and not shared', async () => {
      const client = await open();
      const title = screen.getByLabelText('Title');
      fireEvent.change(title, { target: { value: 'Prepare the demo' } });
      fireEvent.keyDown(title, { key: 'Enter' });
      await waitFor(async () => expect((await client.list('o')).map((m) => m.title)).toContain('Prepare the demo'));
      const added = (await client.list('o')).find((m) => m.title === 'Prepare the demo')!;
      expect([added.ownerLogin, added.source, added.shared]).toEqual(['me', 'mine', false]);
      expect(screen.queryByLabelText('Title')).toBeNull();
    });

    it('does not add an empty title', async () => {
      await open();
      expect((screen.getByRole('button', { name: 'Save mission' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: '   ' } });
      expect((screen.getByRole('button', { name: 'Save mission' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' });
      expect(screen.getByLabelText('Title')).toBeTruthy();
    });

    it('shows the title and Save mission first, with the other fields behind a closed fold', async () => {
      await open();
      const more = screen.getByRole('button', { name: 'More: place, time, person, steps' });
      expect(more.getAttribute('aria-expanded')).toBe('false');
      expect(screen.getByPlaceholderText('What do you want to do?')).toBeTruthy();
      for (const name of ['Steps', 'Place', 'Due', 'Person']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
      expect(screen.queryByRole('switch', { name: 'Share with team' })).toBeNull();
      fireEvent.click(more);
      expect(more.getAttribute('aria-expanded')).toBe('true');
      for (const name of ['Steps', 'Place', 'Due', 'Person']) {
        expect(screen.getByRole('button', { name })).toBeTruthy();
      }
      expect(screen.getByRole('switch', { name: 'Share with team' })).toBeTruthy();
    });

    it('Save mission returns to the list with the new row focused', async () => {
      await open();
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Prepare the demo' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save mission' }));
      const check = await screen.findByRole('checkbox', { name: 'Prepare the demo, done' });
      expect(screen.queryByLabelText('Title')).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(check));
    });

    it('replaces the list while the form is open', async () => {
      await open();
      expect(screen.queryByText('Join the stand-up')).toBeNull();
      expect(screen.queryByRole('button', { name: /Add mission/ })).toBeNull();
    });

    it('Cancel closes the form and adds nothing', async () => {
      const client = await open();
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Never mind' } });
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('Title')).toBeNull();
      expect((await client.list('o')).map((m) => m.title)).not.toContain('Never mind');
    });

    it('shows Saving… while the request runs and keeps the form open with the error when it fails', async () => {
      const inner = createInMemoryMissionsClient('me', SEED);
      let fail!: (e: Error) => void;
      const client: MissionsClient = { ...inner, create: () => new Promise((_, reject) => (fail = reject)) };
      render(<Harness client={client} />);
      fireEvent.click(await screen.findByRole('button', { name: /Add mission/ }));
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Prepare the demo' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save mission' }));
      const saving = await screen.findByRole('button', { name: 'Saving…' });
      expect((saving as HTMLButtonElement).disabled).toBe(true);
      await act(async () => fail(new Error('down')));
      expect((await screen.findByRole('alert')).textContent).toBe('We could not save this mission. Try again.');
      expect((screen.getByRole('button', { name: 'Save mission' }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Prepare the demo');
    });

    it('takes steps, a place, a person and the share switch', async () => {
      const client = await open();
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Plan the offsite' } });
      fireEvent.click(screen.getByRole('button', { name: 'More: place, time, person, steps' }));
      fireEvent.click(screen.getByRole('button', { name: 'Steps' }));
      const step = screen.getByLabelText('New step');
      fireEvent.change(step, { target: { value: 'Pick a date' } });
      fireEvent.keyDown(step, { key: 'Enter' });
      fireEvent.click(screen.getByRole('button', { name: 'Place' }));
      fireEvent.click(within(screen.getByRole('list', { name: 'Places' })).getByRole('button', { name: /Meeting room 1/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Person' }));
      fireEvent.click(within(screen.getByRole('list', { name: 'People' })).getByRole('button', { name: 'Bao Tran' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Share with team' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save mission' }));
      await waitFor(async () => expect((await client.list('o')).some((m) => m.title === 'Plan the offsite')).toBe(true));
      const added = (await client.list('o')).find((m) => m.title === 'Plan the offsite')!;
      expect(added.steps).toEqual([{ text: 'Pick a date', done: false }]);
      expect(added.place).toEqual(ROOM);
      expect(added.personLogin).toBe('bao@x');
      expect(added.shared).toBe(true);
    });

    it('Esc cancels through the escape stack and adds nothing', async () => {
      const client = await open();
      const title = screen.getByLabelText('Title');
      fireEvent.change(title, { target: { value: 'Never mind' } });
      fireEvent.keyDown(title, { key: 'Escape' });
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(screen.queryByLabelText('Title')).toBeNull();
      expect((await client.list('o')).map((m) => m.title)).not.toContain('Never mind');
    });

    it('T opens the form', async () => {
      await setup();
      fireEvent.keyDown(window, { key: 't' });
      expect(await screen.findByLabelText('Title')).toBeTruthy();
    });
  });

  it('asks for a server update, with no rows and no error, when the API is missing', async () => {
    const client: MissionsClient = {
      list: () => Promise.reject(new MissionsUnsupportedError()),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    };
    render(<Harness client={client} />);
    expect(await screen.findByText('Missions need a server update.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add mission/ })).toBeNull();
    expect(screen.queryByText(/Could not reach/)).toBeNull();
  });

  describe('fold', () => {
    it('is open on desktop, folds to a header with the open count, and remembers the choice', async () => {
      await setup();
      const toggle = screen.getByRole('button', { name: 'Collapse missions' });
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(toggle);
      expect(screen.queryByText('Join the stand-up')).toBeNull();
      expect(screen.getByText('2 open')).toBeTruthy();
      expect(localStorage.getItem('officexr:fold:missions')).toBe('folded');
      cleanup();
      render(<Harness client={createInMemoryMissionsClient('me', SEED)} />);
      expect(await screen.findByRole('button', { name: 'Expand missions' })).toBeTruthy();
      expect(screen.queryByText('Join the stand-up')).toBeNull();
    });

    it('opens the folded panel with the add form on T', async () => {
      await setup();
      fireEvent.click(screen.getByRole('button', { name: 'Collapse missions' }));
      fireEvent.keyDown(window, { key: 't' });
      expect(await screen.findByRole('button', { name: 'Collapse missions' })).toBeTruthy();
      expect(screen.getByLabelText('Title')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByText('Join the stand-up')).toBeTruthy();
    });
  });

  describe('compact (phone)', () => {
    it('starts folded to its header and lists every mission once expanded', async () => {
      const many: Mission[] = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `x${i}`, title: `Mission ${i}`, steps: [], place: null, dueAt: null }));
      await setup(many, true);
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(screen.getByText('0/5')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Expand missions' }).getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(screen.getByRole('button', { name: 'Expand missions' }));
      expect(screen.getAllByRole('checkbox')).toHaveLength(5);
    });

    it('opens the new mission form as a bottom sheet', async () => {
      await setup(SEED, true);
      fireEvent.click(screen.getByRole('button', { name: 'Expand missions' }));
      fireEvent.click(screen.getByRole('button', { name: /Add mission/ }));
      expect(screen.getByRole('dialog', { name: 'New mission' })).toBeTruthy();
    });

    it('shows only the form sheet in portrait while adding, not the list behind it', async () => {
      const client = createInMemoryMissionsClient('me', SEED);
      render(<Harness client={client} compact portrait />);
      fireEvent.click(await screen.findByRole('button', { name: 'Expand missions' }));
      fireEvent.click(screen.getByRole('button', { name: /Add mission/ }));
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(screen.getByRole('dialog', { name: 'New mission' })).toBeTruthy();
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('group', { name: 'Source' })).toBeNull();
    });
  });

  describe('portrait (phone held upright)', () => {
    const portrait = async (props: { collapsed?: boolean } = {}) => {
      const client = createInMemoryMissionsClient('me', SEED);
      render(<Harness client={client} compact portrait {...props} />);
      await screen.findByRole('button', { name: 'Expand missions' });
    };

    it('is a one-line chip with the count and no panel', async () => {
      await portrait();
      const chip = screen.getByRole('button', { name: 'Expand missions' });
      expect(chip.textContent).toBe('Missions1/3');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    });

    it('shows the current mission title in the chip, and only the icon and count while collapsed', async () => {
      const client = createInMemoryMissionsClient('me', SEED);
      const view = render(<Harness client={client} compact portrait />);
      await screen.findByRole('button', { name: 'Expand missions' });
      fireEvent.click(screen.getByRole('button', { name: 'Expand missions' }));
      fireEvent.click(screen.getByRole('button', { name: 'Go to Meeting room 1' }));
      fireEvent.click(screen.getByRole('button', { name: 'Collapse missions' }));
      expect(screen.getByRole('button', { name: 'Expand missions' }).textContent).toContain('Join the stand-up');
      view.rerender(<Harness client={client} compact portrait collapsed />);
      expect(screen.getByRole('button', { name: 'Expand missions' }).textContent).toBe('1/3');
    });

    it('opens a sheet with tabs and rows, and closes back to the chip', async () => {
      await portrait();
      fireEvent.click(screen.getByRole('button', { name: 'Expand missions' }));
      const sheet = screen.getByRole('dialog', { name: 'Missions' });
      expect(within(sheet).getByRole('tab', { name: 'Team' })).toBeTruthy();
      expect(within(sheet).getAllByRole('checkbox').length).toBeGreaterThan(0);
      fireEvent.click(within(sheet).getByRole('button', { name: 'Collapse missions' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: 'Expand missions' })).toBeTruthy();
    });

    it('snaps the sheet between 55% and 90% of the height', async () => {
      await portrait();
      fireEvent.click(screen.getByRole('button', { name: 'Expand missions' }));
      const sheet = screen.getByRole('dialog', { name: 'Missions' });
      expect(sheet.style.maxHeight).toContain('* 0.55');
      fireEvent.click(screen.getByRole('button', { name: 'Enlarge missions' }));
      expect(sheet.style.maxHeight).toContain('* 0.9');
    });

    it('clamps a long title to two lines and keeps the Go button from shrinking', async () => {
      const long: Mission[] = [{ ...SEED[0]!, title: 'Prepare the quarterly planning review with every team lead before Friday' }];
      const client = createInMemoryMissionsClient('me', long);
      render(<Harness client={client} compact portrait />);
      fireEvent.click(await screen.findByRole('button', { name: 'Expand missions' }));
      const title = screen.getByText(/Prepare the quarterly/);
      expect(title.className).toContain('line-clamp-2');
      expect(screen.getByRole('button', { name: 'Go to Meeting room 1' }).parentElement!.className).toContain('shrink-0');
    });
  });
});
