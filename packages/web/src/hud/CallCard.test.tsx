// @vitest-environment jsdom
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { CallCard } from './CallCard';
import { fakePlayControls } from './fakePlayControls';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const setup = (inCall: boolean) => {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 }, ...(inCall ? { jitsiRoom: 'room', jitsiParticipantId: 'p-me' } : {}) });
  if (inCall) {
    actions.upsertPlayer({ id: 'bao', name: 'Bao Tran', pos: { x: 3, y: 0, z: 0 }, jitsiParticipantId: 'p-bao' });
    actions.callParticipantJoined('p-bao', 'Bao Tran');
  }
  const voice = new JaasVoiceAdapter({ appId: 'test', getJwt: () => Promise.reject(new Error('no voice')), displayName: 'Me' });
  const leave = vi.spyOn(voice, 'leaveRoom');
  const fake = fakePlayControls();
  const viewYaw = createViewYaw();
  const renders = { count: 0 };
  render(
    <PlayControlsProvider controls={fake.controls}>
      <ViewYawProvider viewYaw={viewYaw}>
        <Profiler id="card" onRender={() => renders.count++}>
          <CallCard store={store} selfId="me" voice={voice} />
        </Profiler>
      </ViewYawProvider>
    </PlayControlsProvider>,
  );
  return { voice, leave, actions, renders };
};

describe('CallCard', () => {
  it('shows nothing when you are not in a call', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: 'Leave call' })).toBeNull();
  });

  it('names who you are talking with and how far away they are', () => {
    setup(true);
    expect(screen.getByText('Talking with Bao Tran')).toBeTruthy();
    expect(screen.getByText('Voice on · 3 m away')).toBeTruthy();
  });

  it('follows the other person by whole metres', () => {
    const { actions, renders } = setup(true);
    const before = renders.count;
    act(() => actions.upsertPlayer({ id: 'bao', name: 'Bao Tran', pos: { x: 3.4, y: 0, z: 0 } }));
    expect(renders.count).toBe(before);
    act(() => actions.upsertPlayer({ id: 'bao', name: 'Bao Tran', pos: { x: 5.2, y: 0, z: 0 } }));
    expect(screen.getByText('Voice on · 5 m away')).toBeTruthy();
  });

  it('ignores distances it does not show', () => {
    const { actions, renders } = setup(true);
    act(() => {
      actions.upsertPlayer({ id: 'cy', name: 'Cy Lee', pos: { x: 6, y: 0, z: 0 }, jitsiParticipantId: 'p-cy' });
      actions.callParticipantJoined('p-cy', 'Cy Lee');
    });
    expect(screen.getByText('In call · 3')).toBeTruthy();
    const before = renders.count;
    act(() => actions.upsertPlayer({ id: 'bao', name: 'Bao Tran', pos: { x: 5.2, y: 0, z: 0 } }));
    expect(renders.count).toBe(before);
  });

  it('mutes and leaves', () => {
    const { voice, leave } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(voice.isMicMuted()).toBe(true);
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Leave call' })));
    expect(leave).toHaveBeenCalled();
  });

  it('folds to the title, mute and leave, and unfolds again', () => {
    setup(true);
    expect(screen.getByRole('button', { name: 'Collapse call card' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse call card' }));
    expect(screen.queryByText('Voice on · 3 m away')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mute microphone' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Leave call' })).toBeTruthy();
    expect(localStorage.getItem('officexr:fold:call')).toBe('folded');
    fireEvent.click(screen.getByRole('button', { name: 'Expand call card' }));
    expect(screen.getByText('Voice on · 3 m away')).toBeTruthy();
  });
});
