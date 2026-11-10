// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPersistentLocalState } from '@officexr/core-refactor';
import { createDefaultApi } from '@officexr/world/app';
import { characterUrl, CHARACTERS, pickCharacterForPlayer } from '@officexr/world/characters';
import { ApplicationProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterAction, CharacterPane } from './CharacterPane';
import { openSettings, SettingsHarness } from './settingsHarness';

afterEach(cleanup);

const OFFICE = '11111111-1111-4111-8111-111111111111';
const SELF = 'a@example.com';
const OTHER = CHARACTERS.find((c) => c !== pickCharacterForPlayer(SELF))!;

function FakePreview({ url }: { url: string }) {
  return <p data-testid="preview">{url}</p>;
}

const UPLOADED = {
  id: 'kaykit-skeletons/characters/gltf/Necromancer',
  label: 'Necromancer',
  gltfPath: '/models/kaykit-skeletons/characters/gltf/Necromancer.glb',
  swatch: '#64748b',
  category: 'character',
};
const PROP = { ...UPLOADED, id: 'kaykit-skeletons/assets/gltf/Skeleton_Axe', label: 'Skeleton Axe', category: 'prop' };

function catalogApi() {
  const catalog = { schemaVersion: 1, updatedAt: 1, kinds: [UPLOADED, PROP] };
  return createDefaultApi({ fetcher: async () => new Response(JSON.stringify(catalog)) });
}

function setup(status = 200) {
  const local = createPersistentLocalState({ selfId: SELF, officeId: OFFICE });
  const fetchFn = vi.fn(async () => new Response('{}', { status }));
  const onSaveResult = vi.fn();
  render(
    <ApplicationProvider api={catalogApi()}>
    <SettingsHarness
      tabs={[{ id: 'controls', label: 'Controls', content: <p>Controls tab</p> }]}
      panes={[
        {
          id: 'character',
          label: 'Character',
          content: <CharacterPane local={local} onSaveResult={onSaveResult} Preview={FakePreview} fetchFn={fetchFn} />,
        },
      ]}
      actions={[{ id: 'character', render: () => <CharacterAction /> }]}
    />
    </ApplicationProvider>,
  );
  openSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Character' }));
  return { local, fetchFn, onSaveResult };
}

describe('CharacterPane', () => {
  it('opens inside Settings, previewing the current character', () => {
    setup();
    expect(screen.queryByText('Controls tab')).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const select = screen.getByRole('combobox', { name: 'Character' }) as HTMLSelectElement;
    expect(screen.getByTestId('preview').textContent).toBe(characterUrl(select.value as (typeof CHARACTERS)[number]));
  });

  it('Back returns to the tabs', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Controls tab')).toBeTruthy();
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('Escape after Back closes Settings', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows and saves the chosen character', async () => {
    const { local, fetchFn, onSaveResult } = setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), { target: { value: OTHER } });
    expect(local.store.getState().players[SELF]?.avatar.model).toBe(OTHER);
    expect(screen.getByTestId('preview').textContent).toBe(characterUrl(OTHER));
    await waitFor(() => expect(onSaveResult).toHaveBeenCalledWith(null));
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/offices/${OFFICE}/character`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ characterId: OTHER }) }),
    );
  });

  it('offers the catalog characters but not its other kinds, and saves one by id', async () => {
    const { local, fetchFn } = setup();
    const option = await screen.findByRole('option', { name: 'Necromancer' });
    expect(screen.queryByRole('option', { name: 'Skeleton Axe' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), { target: { value: (option as HTMLOptionElement).value } });
    expect(local.store.getState().players[SELF]?.avatar.model).toBe(UPLOADED.id);
    expect(screen.getByTestId('preview').textContent).toBe(UPLOADED.gltfPath);
    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith(
        `/api/offices/${OFFICE}/character`,
        expect.objectContaining({ body: JSON.stringify({ characterId: UPLOADED.id }) }),
      ),
    );
  });

  it('reports a failed save', async () => {
    const { onSaveResult } = setup(500);
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), { target: { value: OTHER } });
    await waitFor(() => expect(onSaveResult).toHaveBeenCalledWith('Could not save the character: HTTP 500'));
  });
});
