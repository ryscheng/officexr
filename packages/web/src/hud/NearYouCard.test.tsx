// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakePlayControls } from './fakePlayControls';
import { NearYouButtons, NearYouCard } from './NearYouCard';

afterEach(cleanup);

const setup = (peers: { id: string; name: string; x: number }[]) => {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  for (const p of peers) {
    actions.upsertPlayer({ id: p.id, name: p.name, pos: { x: p.x, y: 0, z: 0 } });
  }
  const fake = fakePlayControls();
  const viewYaw = createViewYaw();
  const wrap = (node: ReactNode) => (
    <PlayControlsProvider controls={fake.controls}>
      <ViewYawProvider viewYaw={viewYaw}>{node}</ViewYawProvider>
    </PlayControlsProvider>
  );
  return { store, fake, wrap };
};

describe('NearYouCard', () => {
  it('names the closest person in reach with their distance', () => {
    const { store, wrap } = setup([
      { id: 'far', name: 'Far Away', x: 30 },
      { id: 'near', name: 'Near Nina', x: 2 },
      { id: 'mid', name: 'Mid Max', x: 6 },
    ]);
    render(wrap(<NearYouCard store={store} onWave={() => {}} />));
    expect(screen.getByText('Near Nina')).toBeTruthy();
    expect(screen.getByText(/2 m/)).toBeTruthy();
    expect(screen.queryByText('Mid Max')).toBeNull();
  });

  it('Speak walks over to them, and Wave waves', () => {
    const { store, fake, wrap } = setup([{ id: 'near', name: 'Near Nina', x: 2 }]);
    const onWave = vi.fn();
    render(wrap(<NearYouCard store={store} onWave={onWave} />));
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    expect(fake.goTos).toEqual(['near']);
    fireEvent.click(screen.getByRole('button', { name: 'Wave' }));
    expect(onWave).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when nobody is within reach', () => {
    const { store, wrap } = setup([{ id: 'far', name: 'Far Away', x: 30 }]);
    render(wrap(<NearYouCard store={store} onWave={() => {}} />));
    expect(screen.queryByRole('button', { name: 'Speak' })).toBeNull();
  });

  it('the phone buttons do the same', () => {
    const { store, fake, wrap } = setup([{ id: 'near', name: 'Near Nina', x: 2 }]);
    const onWave = vi.fn();
    render(wrap(<NearYouButtons store={store} onWave={onWave} />));
    fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wave' }));
    expect(fake.goTos).toEqual(['near']);
    expect(onWave).toHaveBeenCalledTimes(1);
  });
});
