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
    render(<FullMap store={store} officeName="HQ" areas={areas} route={null} onClose={() => {}} />);
    expect(screen.getByText('Lobby')).toBeTruthy();
    expect(screen.getByText('Meeting room 1')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Bao Tran' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'You' })).toBeTruthy();
    expect(screen.getByText('2 people here')).toBeTruthy();
    expect(screen.getByText('No current mission')).toBeTruthy();
  });

  it('draws the route to the current mission with its distance', () => {
    const { store, areas } = setup();
    render(<FullMap store={store} officeName="HQ" areas={areas} route={{ to: { x: 14, z: 0 }, label: 'Join the stand-up', areaId: 'meet' }} onClose={() => {}} />);
    expect(screen.getByText('Join the stand-up · 14 m')).toBeTruthy();
    expect(screen.getByText('Route to current mission · 14 m')).toBeTruthy();
  });

  it('closes with the button and with Esc', () => {
    const { store, areas } = setup();
    const onClose = vi.fn();
    render(<FullMap store={store} officeName="HQ" areas={areas} route={null} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Close/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
