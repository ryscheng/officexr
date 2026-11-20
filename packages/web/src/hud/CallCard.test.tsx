// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JaasVoiceAdapter } from '../voice/JaasVoiceAdapter';
import { CallCard } from './CallCard';
import { fakePlayControls } from './fakePlayControls';

afterEach(cleanup);

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
  render(
    <PlayControlsProvider controls={fake.controls}>
      <ViewYawProvider viewYaw={viewYaw}>
        <CallCard store={store} selfId="me" voice={voice} />
      </ViewYawProvider>
    </PlayControlsProvider>,
  );
  return { voice, leave };
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

  it('mutes and leaves', () => {
    const { voice, leave } = setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(voice.isMicMuted()).toBe(true);
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeTruthy();
    act(() => void fireEvent.click(screen.getByRole('button', { name: 'Leave call' })));
    expect(leave).toHaveBeenCalled();
  });
});
