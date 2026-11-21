// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FullMap } from './FullMap';
import { placeAreas } from './missions/missionRows';

afterEach(cleanup);

const setup = () => {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  actions.upsertPlayer({ id: 'bao', name: 'Bao Tran', pos: { x: 5, y: 0, z: 0 } });
  const areas = placeAreas(
    [
      { id: 'lobby', label: 'Lobby', min: { x: -4, z: -4 }, max: { x: 4, z: 4 } },
      { id: 'meet', label: 'Meeting room 1', min: { x: 10, z: -4 }, max: { x: 18, z: 4 } },
    ],
    [],
  );
  return { store, areas };
};

describe('FullMap', () => {
  it('draws the rooms, the people and you', () => {
    const { store, areas } = setup();
    render(<FullMap store={store} officeName="HQ" areas={areas} route={null} onGoTo={() => true} onClose={() => {}} />);
    expect(screen.getByText('Lobby')).toBeTruthy();
    expect(screen.getByText('Meeting room 1')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Bao Tran' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'You' })).toBeTruthy();
    expect(screen.getByText('2 people here')).toBeTruthy();
    expect(screen.getByText('No current mission')).toBeTruthy();
  });

  it('draws the route to the current mission with its distance', () => {
    const { store, areas } = setup();
    render(<FullMap store={store} officeName="HQ" areas={areas} route={{ to: { x: 14, z: 0 }, label: 'Join the stand-up', areaId: 'meet' }} onGoTo={() => true} onClose={() => {}} />);
    expect(screen.getByText('Join the stand-up · 14 m')).toBeTruthy();
    expect(screen.getByText('Route to current mission · 14 m')).toBeTruthy();
  });

  it('has no close button and closes with Esc', () => {
    const { store, areas } = setup();
    const onClose = vi.fn();
    render(<FullMap store={store} officeName="HQ" areas={areas} route={null} onGoTo={() => true} onClose={onClose} />);
    expect(screen.queryByRole('button', { name: /Close/ })).toBeNull();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('tap to go', () => {
    const tap = (clientX: number, clientY: number) => {
      const svg = screen.getByRole('img', { name: 'Map of the office' });
      vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 280, height: 140, right: 280, bottom: 140, x: 0, y: 0, toJSON() {} });
      fireEvent.click(svg, { clientX, clientY });
    };

    it('sends the world point under the tap', () => {
      const { store, areas } = setup();
      const onGoTo = vi.fn(() => true);
      render(<FullMap store={store} officeName="HQ" areas={areas} route={null} onGoTo={onGoTo} onClose={() => {}} />);
      tap(170, 70);
      expect(onGoTo).toHaveBeenCalledWith({ x: 10, z: 0 });
      expect(screen.getByText('Tap the map to walk there')).toBeTruthy();
    });

    it('says so for a point the player cannot reach, then goes back to the hint', () => {
      vi.useFakeTimers();
      try {
        const { store, areas } = setup();
        render(<FullMap store={store} officeName="HQ" areas={areas} route={null} onGoTo={() => false} onClose={() => {}} />);
        tap(170, 70);
        expect(screen.getByText("Can't go there")).toBeTruthy();
        act(() => void vi.advanceTimersByTime(3100));
        expect(screen.getByText('Tap the map to walk there')).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('marks the target and draws the walk route from you through the waypoints', () => {
      const { store, areas } = setup();
      const { container } = render(
        <FullMap store={store} officeName="HQ" areas={areas} route={null} walk={{ target: { x: 10, z: 2 }, route: [{ x: 4, z: 3 }, { x: 10, z: 2 }] }} onGoTo={() => true} onClose={() => {}} />,
      );
      expect(screen.getByRole('img', { name: 'Walking here' })).toBeTruthy();
      expect(container.querySelector('polyline')?.getAttribute('points')).toBe('0,0 4,3 10,2');
    });
  });

  describe('your arrow', () => {
    const heading = (c: HTMLElement) => c.querySelector('[data-heading]')?.getAttribute('transform');
    const place = () => screen.getByRole('img', { name: 'You' }).getAttribute('transform') ?? '';

    it('turns to the way you face, as the avatar walks', () => {
      const { store, areas } = setup();
      const actions = createActions(store, createBus());
      const { container } = render(<FullMap store={store} officeName="HQ" areas={areas} route={null} onGoTo={() => true} onClose={() => {}} />);
      expect(heading(container)).toBe('rotate(0)');
      act(() => actions.setSelfPosition({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, Math.PI / 2, false));
      expect(heading(container)).toBe('rotate(-90)');
      act(() => actions.setSelfPosition({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, Math.PI, false));
      expect(heading(container)).toBe('rotate(-180)');
    });

    it('moves in steps finer than the old 0.25 m and drags the route start along', () => {
      const { store, areas } = setup();
      const actions = createActions(store, createBus());
      const { container } = render(
        <FullMap store={store} officeName="HQ" areas={areas} route={{ to: { x: 14, z: 0 }, label: 'Stand-up', areaId: 'meet' }} onGoTo={() => true} onClose={() => {}} />,
      );
      const seen = new Set<string>();
      for (const x of [0.02, 0.07, 0.11, 0.16]) {
        act(() => actions.setSelfPosition({ x, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, false));
        seen.add(place());
        expect(place()).toContain(`translate(${x} 0)`);
        expect(container.querySelector('polyline')?.getAttribute('points')).toBe(`${x},0 14,0`);
      }
      expect(seen.size).toBe(4);
    });

    it('does not rerender the floor while you walk', () => {
      const { store, areas } = setup();
      const actions = createActions(store, createBus());
      const { container } = render(<FullMap store={store} officeName="HQ" areas={areas} route={null} onGoTo={() => true} onClose={() => {}} />);
      const room = container.querySelector('rect[rx="0.4"]');
      act(() => actions.setSelfPosition({ x: 0.1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0, false));
      expect(container.querySelector('rect[rx="0.4"]')).toBe(room);
    });
  });

  describe('floor plan', () => {
    it('draws the floor, walls, desks and plants from the world objects', () => {
      const { store, areas } = setup();
      const plan = [
        { x: -4, z: -4, w: 22, d: 8, tone: 'floor' as const },
        { x: -4, z: -4, w: 22, d: 0.2, tone: 'wall' as const },
        { x: 1, z: 1, w: 1.6, d: 0.8, tone: 'desk' as const },
        { x: 3, z: 2, w: 0.5, d: 0.5, tone: 'furniture' as const },
      ];
      const { container } = render(<FullMap store={store} officeName="HQ" plan={plan} areas={areas} route={null} onGoTo={() => true} onClose={() => {}} />);
      expect(container.querySelectorAll('rect.fill-map-floor').length).toBe(1);
      expect(container.querySelectorAll('rect.fill-map-wall').length).toBe(1);
      expect(container.querySelectorAll('rect.fill-map-desk').length).toBe(1);
      const plant = container.querySelector('circle.fill-map-furniture');
      expect(plant?.getAttribute('r')).toBe('0.25');
    });

    it('draws the plan even when rooms are defined', () => {
      const { store, areas } = setup();
      const { container } = render(<FullMap store={store} officeName="HQ" plan={[{ x: 0, z: 0, w: 2, d: 2, tone: 'wall' }]} areas={areas} route={null} onGoTo={() => true} onClose={() => {}} />);
      expect(container.querySelectorAll('rect.fill-map-wall').length).toBe(1);
    });
  });
});
