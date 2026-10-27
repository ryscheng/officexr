// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { deriveZoneRoom } from '@officexr/core-refactor';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { ZoneCallLabel } from './ZoneCallLabel';

afterEach(cleanup);

describe('ZoneCallLabel', () => {
  it('names the zone while the player is in its call, and nothing for proximity or no call', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    actions.upsertPlayer({ id: 'me', name: 'Me' });
    actions.setVoiceZones([{ id: 'z1', label: 'Meeting Room', min: { x: 0, z: 0 }, max: { x: 5, z: 5 } }]);
    const { container } = render(<ZoneCallLabel store={store} />);
    expect(container.textContent).toBe('');

    act(() => actions.setMyJitsiRoom(deriveZoneRoom('o', 'z1')));
    expect(screen.getByText('In Meeting Room call')).toBeTruthy();

    act(() => actions.setMyJitsiRoom('room-o-me'));
    expect(container.textContent).toBe('');
  });
});
