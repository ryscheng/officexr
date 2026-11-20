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
  const actions = { toggleHand: vi.fn(), toggleFocus: vi.fn() };
  const keys = createPlaceKeyHandler(host, () => []);
  window.addEventListener('keydown', keys.onKeyDown, true);
  render(<Status actions={actions} />);
  return { mode, actions, stop: () => window.removeEventListener('keydown', keys.onKeyDown, true) };
}

describe('build mode and status hotkeys', () => {
  it('R turns the ghost while build mode is open', () => {
    const { mode, stop } = setup();
    mode.setOpen(true);
    fireEvent.keyDown(window, { key: 'r' });
    expect(mode.get().yawDeg).toBe(90);
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

  it('Alt+N toggles focus mode', () => {
    const { actions, stop } = setup();
    fireEvent.keyDown(window, { key: 'n', code: 'KeyN', altKey: true });
    expect(actions.toggleFocus).toHaveBeenCalledTimes(1);
    stop();
  });
});
