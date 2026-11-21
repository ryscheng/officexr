// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { ApplicationProvider } from '@officexr/world/react';
import { createDefaultApi } from '@officexr/world/app';
import { characterUrl } from '@officexr/world/characters';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonAvatar } from './PersonAvatar';
import { PlayerPortraits } from './playerPortrait';

const requested: (string | undefined)[] = [];
vi.mock('@officexr/world/top-down', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@officexr/world/top-down')>()),
  useCharacterPortrait: (url: string | undefined) => {
    requested.push(url);
    return url ? `data:image/png;base64,${encodeURIComponent(url)}` : null;
  },
}));

afterEach(() => {
  cleanup();
  requested.length = 0;
});

const status = { dot: 'bg-green-500', label: 'Available' } as never;

function setup() {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  actions.upsertPlayer({ id: 'bo', name: 'Bo', pos: { x: 0, y: 0, z: 0 }, avatar: { model: 'Mage' } } as never);
  const api = createDefaultApi({ fetcher: async () => new Response(JSON.stringify({ schemaVersion: 1, updatedAt: 1, kinds: [] })) });
  return { store, api };
}

describe('PersonAvatar portraits', () => {
  it("shows the player's chosen character as an image", () => {
    const { store, api } = setup();
    const { container } = render(
      <ApplicationProvider api={api}>
        <PlayerPortraits store={store}>
          <PersonAvatar id="bo" label="Bo" status={status} />
        </PlayerPortraits>
      </ApplicationProvider>,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toContain(encodeURIComponent(characterUrl('Mage')));
  });

  it('keeps the initial for someone with no known character', () => {
    const { store, api } = setup();
    const { container, getByText } = render(
      <ApplicationProvider api={api}>
        <PlayerPortraits store={store}>
          <PersonAvatar id="gone" label="Gus" status={status} />
        </PlayerPortraits>
      </ApplicationProvider>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('G')).toBeTruthy();
  });

  it('keeps the initial outside the HUD provider', () => {
    const { container, getByText } = render(<PersonAvatar id="bo" label="Bo" status={status} />);
    expect(container.querySelector('img')).toBeNull();
    expect(getByText('B')).toBeTruthy();
  });
});
