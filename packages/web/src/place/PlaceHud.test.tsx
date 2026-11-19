// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createStore, MAX_PLACED_PROPS } from '@officexr/sdk';
import { createPlaceMode } from '@officexr/world/motion';
import { PlaceButton, PlacePalette, usePlaceHotkey } from './PlaceHud';

afterEach(cleanup);

function Hotkey({ mode, enabled = true }: { mode: ReturnType<typeof createPlaceMode>; enabled?: boolean }) {
  usePlaceHotkey(mode, enabled);
  return null;
}

describe('place mode HUD', () => {
  it('shows no palette until build mode opens, then the four props and the placed count', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    store.setState(() => ({ placedProps: [{ id: 'placed:1', kindId: 'prop_pool', position: [0, 0, 0], yawDeg: 0 }] }));
    const mode = createPlaceMode();
    render(<PlacePalette mode={mode} store={store} />);
    expect(screen.queryByRole('region', { name: 'Build mode' })).toBeNull();

    act(() => mode.setOpen(true));
    expect(screen.getByText(`1 / ${MAX_PLACED_PROPS} props`)).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Pool', 'Scooter rack', 'Tricycle rack', 'Wand stand']);
  });

  it('chooses a prop on a click, and shows a refusal and a blocked spot', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const mode = createPlaceMode();
    mode.setOpen(true);
    render(<PlacePalette mode={mode} store={store} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wand stand' }));
    expect(mode.get().kindId).toBe('prop_wand_stand');
    act(() => mode.setGhost({ position: [0, 0, 0], valid: false, targetId: null }));
    expect(screen.getByRole('status').textContent).toBe('No room for it here.');
    act(() => mode.setNotice('This office has the most props it can hold.'));
    expect(screen.getByRole('status').textContent).toBe('This office has the most props it can hold.');
  });

  it('the Build button and B toggle the mode, but B stands down in a text field or when disabled', () => {
    const mode = createPlaceMode();
    render(
      <>
        <Hotkey mode={mode} />
        <PlaceButton mode={mode} />
        <input aria-label="text" />
      </>,
    );
    fireEvent.keyDown(window, { key: 'b' });
    expect(mode.get().open).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('text'), { key: 'b' });
    expect(mode.get().open).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Build/ }));
    expect(mode.get().open).toBe(false);

    cleanup();
    render(<Hotkey mode={mode} enabled={false} />);
    fireEvent.keyDown(window, { key: 'b' });
    expect(mode.get().open).toBe(false);
  });
});
