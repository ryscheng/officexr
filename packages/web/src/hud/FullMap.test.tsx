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
});
