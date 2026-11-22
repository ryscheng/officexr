// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createStore } from '@officexr/sdk';
import { PlayControlsProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SocialToastQueue } from '../ping/socialToasts';
import { fakePlayControls } from './fakePlayControls';
import { SocialToastView } from './SocialToast';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(paused = false) {
  const queue = new SocialToastQueue();
  const store = createStore({ selfId: 'me#t0', officeId: 'o' });
  store.setState((s) => ({ ...s, players: { 'ana#t1': { name: 'Ana' }, 'ben#t2': { name: 'Ben' } } as never }));
  const play = fakePlayControls();
  const waveBack = vi.fn();
  const view = (isPaused: boolean) => (
    <PlayControlsProvider controls={play.controls}>
      <SocialToastView queue={queue} store={store} paused={isPaused} onWaveBack={waveBack} />
    </PlayControlsProvider>
  );
  const { rerender } = render(view(paused));
  return { queue, play, waveBack, setPaused: (p: boolean) => rerender(view(p)) };
}

describe('SocialToastView', () => {
  it('shows an invite and Join walks to the inviter', () => {
    const { queue, play } = setup();
    act(() => queue.add('invite', 'ana#t1', 'Ana'));
    expect(screen.getByText('Ana invites you to talk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(play.goTos).toEqual(['ana#t1']);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a wave and Wave back sends one back', () => {
    const { queue, waveBack } = setup();
    act(() => queue.add('wave', 'ben#t2', 'Ben'));
    expect(screen.getByText('Ben waved at you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wave back' }));
    expect(waveBack).toHaveBeenCalledWith('ben#t2');
  });

  it('shows a ping with Go to', () => {
    const { queue, play } = setup();
    act(() => queue.add('ping', 'ben#t2', 'Ben'));
    expect(screen.getByText('Ben pinged you')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Ben' }));
    expect(play.goTos).toEqual(['ben#t2']);
  });

  it('shows one at a time and the next after Dismiss', () => {
    const { queue } = setup();
    act(() => {
      queue.add('invite', 'ana#t1', 'Ana');
      queue.add('wave', 'ben#t2', 'Ben');
    });
    expect(screen.getAllByRole('status')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('Ben waved at you')).toBeTruthy();
  });

  it('waits while a sheet is open and expires after ten seconds on screen', () => {
    vi.useFakeTimers();
    const { queue, setPaused } = setup(true);
    act(() => queue.add('invite', 'ana#t1', 'Ana'));
    act(() => void vi.advanceTimersByTime(20_000));
    expect(queue.getSnapshot()).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
    setPaused(false);
    expect(screen.getByText('Ana invites you to talk')).toBeTruthy();
    act(() => void vi.advanceTimersByTime(10_001));
    expect(queue.getSnapshot()).toEqual([]);
  });

  it('disables the action once the sender has left', () => {
    const { queue } = setup();
    act(() => queue.add('invite', 'gone#t9', 'Gus'));
    expect((screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
