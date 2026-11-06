// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { deriveZoneRoom } from '@officexr/core-refactor';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { ZoneCallLabel } from './ZoneCallLabel';

afterEach(cleanup);

describe('ZoneCallLabel', () => {
  it('names the zone in a zone call, the proximity call otherwise, and prompts when not in a call', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    actions.upsertPlayer({ id: 'me', name: 'Me' });
    actions.setVoiceZones([{ id: 'z1', label: 'Meeting Room', min: { x: 0, z: 0 }, max: { x: 5, z: 5 } }]);
    render(<ZoneCallLabel store={store} joining={false} />);
    expect(screen.getByText('Not in a call')).toBeTruthy();
    expect(screen.getByText('Walk up to someone to talk')).toBeTruthy();

    act(() => actions.setMyJitsiRoom(deriveZoneRoom('o', 'z1')));
    expect(screen.getByText('Meeting Room')).toBeTruthy();

    act(() => actions.setMyJitsiRoom('room-o-me'));
    expect(screen.getByText('Proximity call')).toBeTruthy();
  });
});
