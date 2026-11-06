import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, createActions, createBus } from '@officexr/sdk';
import type { Store } from '@officexr/sdk';
import { CallRosterSync } from '../communication/call-roster-sync.ts';
import { MockVoiceAdapter } from '../communication/mock-voice-adapter.ts';

describe('CallRosterSync', () => {
  let store: Store;
  let voice: MockVoiceAdapter;
  let sync: CallRosterSync;
  const roster = () => store.getState().callRoster;
  const selfJitsiId = () => store.getState().players['me']?.jitsiParticipantId;

  beforeEach(() => {
    store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    actions.upsertPlayer({ id: 'me', name: 'Me' });
    voice = new MockVoiceAdapter();
    sync = new CallRosterSync({ actions, voice });
    sync.start();
  });

  it('tracks remote participants and the local participant id', async () => {
    await voice.joinRoom('r1');
    expect(selfJitsiId()).toBe('local-r1');
    voice.emitParticipantJoined('jp-a', 'Ann');
    voice.emitParticipantJoined('jp-b', 'Bob');
    voice.emitParticipantLeft('jp-a');
    expect(roster()).toEqual({ 'jp-b': { displayName: 'Bob' } });
  });

  it('clears the roster when switching rooms', async () => {
    await voice.joinRoom('r1');
    voice.emitParticipantJoined('jp-a', 'Ann');
    await voice.joinRoom('r2');
    expect(roster()).toEqual({});
    expect(selfJitsiId()).toBe('local-r2');
  });

  it.each(['idle', 'error'] as const)('clears the roster and self id on %s', async (state) => {
    await voice.joinRoom('r1');
    voice.emitParticipantJoined('jp-a', 'Ann');
    voice.emitConnectionState(state);
    expect(roster()).toEqual({});
    expect(selfJitsiId()).toBeNull();
  });

  it('clears on an error then rejoin of the same room', async () => {
    await voice.joinRoom('r1');
    voice.emitParticipantJoined('jp-a', 'Ann');
    voice.emitConnectionState('error');
    voice.emitConnectionState('joining');
    voice.emitConnectionState('connected');
    voice.emitParticipantJoined('jp-b', 'Bob');
    expect(roster()).toEqual({ 'jp-b': { displayName: 'Bob' } });
  });

  it('ignores events from a stale room', async () => {
    await voice.joinRoom('r1');
    voice.emitParticipantJoined('jp-a', 'Ann');
    voice.emitParticipantJoined('jp-b', 'Bob', 'old');
    voice.emitParticipantLeft('jp-a', 'old');
    expect(roster()).toEqual({ 'jp-a': { displayName: 'Ann' } });
  });

  it('stops listening and clears on stop', async () => {
    await voice.joinRoom('r1');
    voice.emitParticipantJoined('jp-a', 'Ann');
    sync.stop();
    expect(roster()).toEqual({});
    voice.emitParticipantJoined('jp-b', 'Bob');
    expect(roster()).toEqual({});
  });
});
