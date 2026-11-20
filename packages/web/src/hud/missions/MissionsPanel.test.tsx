// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Mission, MissionsClient } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryMissionsClient } from './inMemoryMissions';
import { MissionsUnsupportedError } from './missionsApi';
import { MissionsPanel } from './MissionsPanel';
import { placeAreas } from './missionRows';
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
const PEOPLE = [{ id: 'bao@x', login: 'bao@x', name: 'Bao Tran', x: 0, z: 0 }];

function Harness({ client, compact = false }: { client: MissionsClient; compact?: boolean }) {
  const missions = useMissions(client, 'o');
  return <MissionsPanel missions={missions} me="me" areas={AREAS} people={PEOPLE} self={{ x: 0, z: 5 }} compact={compact} now={() => NOW} />;
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
      fireEvent.click(screen.getByRole('button', { name: /New mission/ }));
      return client;
    };

    it('Enter adds a mission owned by me and not shared', async () => {
      const client = await open();
      const title = screen.getByLabelText('Mission title');
      fireEvent.change(title, { target: { value: 'Prepare the demo' } });
      fireEvent.keyDown(title, { key: 'Enter' });
      await waitFor(async () => expect((await client.list('o')).map((m) => m.title)).toContain('Prepare the demo'));
      const added = (await client.list('o')).find((m) => m.title === 'Prepare the demo')!;
      expect([added.ownerLogin, added.source, added.shared]).toEqual(['me', 'mine', false]);
      expect(screen.queryByLabelText('Mission title')).toBeNull();
    });

    it('does not add an empty title', async () => {
      await open();
      expect((screen.getAllByRole('button', { name: 'Add' }).at(-1) as HTMLButtonElement).disabled).toBe(true);
    });

    it('takes steps, a place, a person and the share switch', async () => {
      const client = await open();
      fireEvent.change(screen.getByLabelText('Mission title'), { target: { value: 'Plan the offsite' } });
      fireEvent.click(screen.getByRole('button', { name: 'Steps' }));
      const step = screen.getByLabelText('New step');
      fireEvent.change(step, { target: { value: 'Pick a date' } });
      fireEvent.keyDown(step, { key: 'Enter' });
      fireEvent.click(screen.getByRole('button', { name: 'Place' }));
      fireEvent.click(within(screen.getByRole('list', { name: 'Places' })).getByRole('button', { name: /Meeting room 1/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Person' }));
      fireEvent.click(within(screen.getByRole('list', { name: 'People' })).getByRole('button', { name: 'Bao Tran' }));
      fireEvent.click(screen.getByRole('switch', { name: 'Share with team' }));
      fireEvent.click(screen.getAllByRole('button', { name: 'Add' }).at(-1)!);
      await waitFor(async () => expect((await client.list('o')).some((m) => m.title === 'Plan the offsite')).toBe(true));
      const added = (await client.list('o')).find((m) => m.title === 'Plan the offsite')!;
      expect(added.steps).toEqual([{ text: 'Pick a date', done: false }]);
      expect(added.place).toEqual(ROOM);
      expect(added.personLogin).toBe('bao@x');
      expect(added.shared).toBe(true);
    });

    it('Esc cancels through the escape stack and adds nothing', async () => {
      const client = await open();
      const title = screen.getByLabelText('Mission title');
      fireEvent.change(title, { target: { value: 'Never mind' } });
      fireEvent.keyDown(title, { key: 'Escape' });
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(screen.queryByLabelText('Mission title')).toBeNull();
      expect((await client.list('o')).map((m) => m.title)).not.toContain('Never mind');
    });

    it('T opens the form', async () => {
      await setup();
      fireEvent.keyDown(window, { key: 't' });
      expect(await screen.findByLabelText('Mission title')).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: /New mission/ })).toBeNull();
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
      fireEvent.click(screen.getByRole('button', { name: /New mission/ }));
      expect(screen.getByRole('dialog', { name: 'New mission' })).toBeTruthy();
    });
  });
});
