// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createPersistentLocalState } from '@officexr/core-refactor';
import { CHARACTERS, pickCharacterForPlayer, type CharacterName } from '@officexr/world/characters';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterAction, CharacterPane } from './CharacterPane';
import { openSettings, SettingsHarness } from './settingsHarness';

afterEach(cleanup);

const OFFICE = '11111111-1111-4111-8111-111111111111';
const SELF = 'a@example.com';
const OTHER = CHARACTERS.find((c) => c !== pickCharacterForPlayer(SELF))!;

function FakePreview({ character }: { character: CharacterName }) {
  return <p data-testid="preview">{character}</p>;
}

function setup(status = 200) {
  const local = createPersistentLocalState({ selfId: SELF, officeId: OFFICE });
  const fetchFn = vi.fn(async () => new Response('{}', { status }));
  const onSaveResult = vi.fn();
  render(
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
    />,
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
    expect(screen.getByTestId('preview').textContent).toBe(select.value);
  });

  it('Back returns to the tabs', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Controls tab')).toBeTruthy();
    expect(screen.queryByTestId('preview')).toBeNull();
  });

  it('shows and saves the chosen character', async () => {
    const { local, fetchFn, onSaveResult } = setup();
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), { target: { value: OTHER } });
    expect(local.store.getState().players[SELF]?.avatar.model).toBe(OTHER);
    expect(screen.getByTestId('preview').textContent).toBe(OTHER);
    await waitFor(() => expect(onSaveResult).toHaveBeenCalledWith(null));
    expect(fetchFn).toHaveBeenCalledWith(
      `/api/offices/${OFFICE}/character`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ characterId: OTHER }) }),
    );
  });

  it('reports a failed save', async () => {
    const { onSaveResult } = setup(500);
    fireEvent.change(screen.getByRole('combobox', { name: 'Character' }), { target: { value: OTHER } });
    await waitFor(() => expect(onSaveResult).toHaveBeenCalledWith('Could not save the character: HTTP 500'));
  });
});
