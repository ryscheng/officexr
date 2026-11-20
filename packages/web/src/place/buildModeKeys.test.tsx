// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlaceMode, type PlacementHost } from '@officexr/world/motion';
import { createPlaceKeyHandler } from '@officexr/world/top-down';
import { useStatusHotkeys } from '../status/useStatusHotkeys';

afterEach(cleanup);

function Status({ actions }: { actions: Parameters<typeof useStatusHotkeys>[0] }) {
  useStatusHotkeys(actions);
  return null;
}

function setup() {
  const mode = createPlaceMode();
  const host: PlacementHost = { mode, send: vi.fn(async () => ({ ok: true as const })) };
  const actions = { toggleHand: vi.fn(), toggleEmotePicker: vi.fn(), toggleFocus: vi.fn() };
  const keys = createPlaceKeyHandler(host, () => []);
  window.addEventListener('keydown', keys.onKeyDown, true);
  render(<Status actions={actions} />);
  return { mode, actions, stop: () => window.removeEventListener('keydown', keys.onKeyDown, true) };
}

describe('R in build mode and outside it', () => {
  it('turns the ghost and does not open the emote picker while build mode is open', () => {
    const { mode, actions, stop } = setup();
    mode.setOpen(true);
    fireEvent.keyDown(window, { key: 'r' });
    expect(mode.get().yawDeg).toBe(90);
    expect(actions.toggleEmotePicker).not.toHaveBeenCalled();
    stop();
  });

  it('opens the emote picker as before when build mode is closed', () => {
    const { mode, actions, stop } = setup();
    fireEvent.keyDown(window, { key: 'r' });
    expect(mode.get().yawDeg).toBe(0);
    expect(actions.toggleEmotePicker).toHaveBeenCalledTimes(1);
    stop();
  });

  it('the status hotkeys ignore any keydown another handler already claimed', () => {
    const { actions, stop } = setup();
    const claim = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', claim, true);
    fireEvent.keyDown(window, { key: 'h' });
    window.removeEventListener('keydown', claim, true);
    expect(actions.toggleHand).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'h' });
    expect(actions.toggleHand).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps H free for the hand while building', () => {
    const { mode, actions, stop } = setup();
    mode.setOpen(true);
    fireEvent.keyDown(window, { key: 'h' });
    expect(actions.toggleHand).toHaveBeenCalledTimes(1);
    stop();
  });
});
