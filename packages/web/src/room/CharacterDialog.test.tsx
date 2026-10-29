// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { createPersistentLocalState, type PersistentLocalState } from '@officexr/core-refactor';
import { CHARACTERS, pickCharacterForPlayer, type CharacterName } from '@officexr/world/characters';
import { useWorldFocus } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CharacterDialog, CharacterMenuItem } from './CharacterDialog';
import { RoomMenu } from './RoomMenu';

afterEach(cleanup);

const OFFICE = '11111111-1111-4111-8111-111111111111';
const SELF = 'a@example.com';
const OTHER = CHARACTERS.find((c) => c !== pickCharacterForPlayer(SELF))!;

function FakePreview({ character }: { character: CharacterName }) {
  return <p data-testid="preview">{character}</p>;
}

function Harness({
  local,
  onSaveResult,
  fetchFn,
}: {
  local: PersistentLocalState;
  onSaveResult: (error: string | null) => void;
  fetchFn: typeof fetch;
}) {
  const focused = useWorldFocus();
  const [open, setOpen] = useState(false);
  return (
    <>
      <output>{String(focused)}</output>
      <RoomMenu>
        <CharacterMenuItem onSelect={() => setOpen(true)} />
      </RoomMenu>
      {open && (
        <CharacterDialog
          local={local}
          onSaveResult={onSaveResult}
          onClose={() => setOpen(false)}
          Preview={FakePreview}
          fetchFn={fetchFn}
        />
      )}
    </>
  );
}

function setup(status = 200) {
  const local = createPersistentLocalState({ selfId: SELF, officeId: OFFICE });
  const fetchFn = vi.fn(async () => new Response('{}', { status }));
  const onSaveResult = vi.fn();
  render(<Harness local={local} onSaveResult={onSaveResult} fetchFn={fetchFn} />);
  fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
  fireEvent.click(screen.getByRole('button', { name: 'Change character…' }));
  return { local, fetchFn, onSaveResult };
}

describe('CharacterDialog', () => {
  it('opens from the menu, previewing the current character', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Character' })).toBeTruthy();
    const select = screen.getByRole('combobox', { name: 'Character' }) as HTMLSelectElement;
    expect(screen.getByTestId('preview').textContent).toBe(select.value);
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

  it.each([
    ['Escape', () => fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })],
    ['a backdrop press', () => fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)],
    ['Done', () => fireEvent.click(screen.getByRole('button', { name: 'Done' }))],
  ])('hands keyboard control back to the world when closed by %s', (_, close) => {
    setup();
    expect(screen.getByRole('status').textContent).toBe('false');
    close();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('true');
  });
});
