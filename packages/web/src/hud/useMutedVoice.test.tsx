// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMutedVoice } from './useMutedVoice';

afterEach(cleanup);

const setup = (muted: string[]) => {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me', name: 'Me' });
  const voice = { setMutedParticipants: vi.fn() };
  const view = renderHook(({ set }) => useMutedVoice(store, voice, set), { initialProps: { set: new Set(muted) } });
  const join = (id: string, participantId: string) =>
    act(() => actions.applyRemotePresence(id, 'available', 'none', 0, { room: 'r', participantId }));
  return { actions, voice, view, join };
};

describe('useMutedVoice', () => {
  it('passes the call ids of muted logins only, and never your own', () => {
    const { voice, join } = setup(['ann@example.test', 'me']);
    join('ann@example.test#a', 'j-ann');
    join('bob@example.test#a', 'j-bob');
    expect(voice.setMutedParticipants).toHaveBeenLastCalledWith(['j-ann']);
  });

  it('follows a muted person to a new call id', () => {
    const { voice, join } = setup(['ann@example.test']);
    join('ann@example.test#a', 'j-1');
    join('ann@example.test#a', 'j-2');
    expect(voice.setMutedParticipants).toHaveBeenLastCalledWith(['j-2']);
  });

  it('updates when the muted set changes, and restores everyone when it empties', () => {
    const { voice, join, view } = setup([]);
    join('ann@example.test#a', 'j-ann');
    expect(voice.setMutedParticipants).toHaveBeenLastCalledWith([]);
    view.rerender({ set: new Set(['ann@example.test']) });
    expect(voice.setMutedParticipants).toHaveBeenLastCalledWith(['j-ann']);
    view.rerender({ set: new Set() });
    expect(voice.setMutedParticipants).toHaveBeenLastCalledWith([]);
  });

  it('does nothing without a voice adapter', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    expect(() => renderHook(() => useMutedVoice(store, null, new Set(['a'])))).not.toThrow();
  });
});
