// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPersistentLocalState } from '@officexr/core-refactor';
import { createDefaultApi } from '@officexr/world/app';
import { characterUrl, CHARACTERS, pickCharacterForPlayer } from '@officexr/world/characters';
import { ApplicationProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterLook } from './CharacterLook';

afterEach(cleanup);

const OFFICE = '11111111-1111-4111-8111-111111111111';
const SELF = 'a@example.com';
const OTHER = CHARACTERS.find((c) => c !== pickCharacterForPlayer(SELF))!;

function FakePreview({ url, onShown }: { url: string; onShown?: (url: string) => void }) {
  return (
    <>
      <p data-testid="preview">{url}</p>
      <button type="button" onClick={() => onShown?.(url)}>
        finish loading
      </button>
    </>
  );
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
      <CharacterLook local={local} onSaveResult={onSaveResult} Preview={FakePreview} fetchFn={fetchFn} />
    </ApplicationProvider>,
  );
  return { local, fetchFn, onSaveResult };
}

const pick = (name: string) => fireEvent.click(screen.getByRole('radio', { name }));

describe('CharacterLook', () => {
  it('previews the current character and marks it selected', () => {
    setup();
    const selected = screen.getAllByRole('radio').find((r) => r.getAttribute('aria-checked') === 'true')!;
    expect(screen.getAllByRole('radio').filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.getByTestId('preview').textContent).toBe(characterUrl(selected.getAttribute('aria-label') as (typeof CHARACTERS)[number]));
  });

  it('shows and saves the chosen character', async () => {
    const { local, fetchFn, onSaveResult } = setup();
    pick(OTHER);
    expect(local.store.getState().players[SELF]?.avatar.model).toBe(OTHER);
    expect(screen.getByTestId('preview').textContent).toBe(characterUrl(OTHER));
    expect(screen.getByRole('radio', { name: OTHER }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(onSaveResult).toHaveBeenCalledWith(null));
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/offices/${OFFICE}/character`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ characterId: OTHER }) }),
    );
  });

  it('offers the catalog characters but not its other kinds, and saves one by id', async () => {
    const { local, fetchFn } = setup();
    await screen.findByRole('radio', { name: 'Necromancer' });
    expect(screen.queryByRole('radio', { name: 'Skeleton Axe' })).toBeNull();
    pick('Necromancer');
    expect(local.store.getState().players[SELF]?.avatar.model).toBe(UPLOADED.id);
    expect(screen.getByTestId('preview').textContent).toBe(UPLOADED.gltfPath);
    await waitFor(() =>
      expect(fetchFn).toHaveBeenCalledWith(
        `/api/offices/${OFFICE}/character`,
        expect.objectContaining({ body: JSON.stringify({ characterId: UPLOADED.id }) }),
      ),
    );
  });

  it('covers the preview with the portrait until the 3D model is shown, and again after a change', () => {
    setup();
    const portrait = () => screen.getByTestId('preview-portrait');
    expect(portrait().className).toContain('opacity-100');
    fireEvent.click(screen.getByRole('button', { name: 'finish loading' }));
    expect(portrait().className).toContain('opacity-0');
    pick(OTHER);
    expect(portrait().className).toContain('opacity-100');
    fireEvent.click(screen.getByRole('button', { name: 'finish loading' }));
    expect(portrait().className).toContain('opacity-0');
  });

  it('reports a failed save', async () => {
    const { onSaveResult } = setup(500);
    pick(OTHER);
    await waitFor(() => expect(onSaveResult).toHaveBeenCalledWith('Could not save the character: HTTP 500'));
  });
});
