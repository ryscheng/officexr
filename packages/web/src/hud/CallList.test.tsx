// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallList, callRows } from './CallList';
import { fakePlayControls } from './fakePlayControls';
import { PresenceList } from './PresenceList';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const player = (id: string, name: string, jitsiParticipantId: string | null) => ({
  id,
  name,
  status: 'available' as const,
  mic: 'muted' as const,
  distanceM: 3,
  bearingDeg: 45,
  jitsiParticipantId,
});

describe('callRows', () => {
  it('puts You first, matches peers by participant id and sorts the rest by name', () => {
    const rows = callRows(
      [
        { id: 'j-zed', displayName: 'Zed' },
        { id: 'j-guest', displayName: 'Bea' },
        { id: 'j-amy', displayName: 'ignored' },
      ],
      [player('me', 'Me', 'j-me'), player('amy', 'Amy', 'j-amy'), player('zed', 'Zed', 'j-zed')],
      'me',
    );
    expect(rows.map((r) => [r.label, r.type])).toEqual([
      ['You', 'self'],
      ['Amy', 'peer'],
      ['Bea', 'guest'],
      ['Zed', 'peer'],
    ]);
  });

  it('falls back to Guest for an unmatched participant without a name', () => {
    const rows = callRows([{ id: 'j1', displayName: '' }], [player('me', 'Me', 'j-me')], 'me');
    expect(rows.map((r) => r.label)).toEqual(['You', 'Guest']);
  });

  it('numbers labels in join order across everyone, not roster order or call membership', () => {
    const rows = callRows(
      [
        { id: 'j-b', displayName: '' },
        { id: 'j-c', displayName: '' },
      ],
      [
        player('mark#a', 'Mark', null),
        player('mark#b', 'Mark', 'j-b'),
        player('me', 'Me', 'j-me'),
        player('mark#c', 'Mark', 'j-c'),
      ],
      'me',
    );
    expect(rows.map((r) => r.label)).toEqual(['You', 'Mark (2)', 'Mark (3)']);
  });

  it('counts self towards a shared login', () => {
    const rows = callRows(
      [{ id: 'j-b', displayName: '' }],
      [player('mark#a', 'Mark', 'j-me'), player('mark#b', 'Mark', 'j-b')],
      'mark#a',
    );
    expect(rows.map((r) => r.label)).toEqual(['You', 'Mark (2)']);
  });
});

describe('CallList', () => {
  function setup() {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    const actions = createActions(store, createBus());
    actions.upsertPlayer({ id: 'me', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
    actions.upsertPlayer({ id: 'ann', name: 'Ann', pos: { x: 0, y: 0, z: -12 } });
    render(
      <PlayControlsProvider controls={fakePlayControls().controls}>
        <ViewYawProvider viewYaw={createViewYaw()}>
          <PresenceList store={store} selfId="me" officeName="HQ" />
          <CallList store={store} selfId="me" />
        </ViewYawProvider>
      </PlayControlsProvider>,
    );
    return actions;
  }

  it('says when you are not in a call or still joining', () => {
    const actions = setup();
    expect(screen.getByText('Not in a call')).toBeTruthy();
    expect(screen.getByRole('img', { name: '0 in call' })).toBeTruthy();

    act(() => actions.setMyJitsiRoom('room'));
    expect(screen.getByText('Joining call', { selector: 'p' })).toBeTruthy();
  });

  it('lists a matched peer in both lists, with a mic only in the call list', () => {
    const actions = setup();
    act(() => {
      actions.setMyJitsiRoom('room');
      actions.setMyJitsiParticipantId('j-me');
      actions.setSelfPresence({ mic: 'muted' });
      actions.applyRemotePresence('ann', 'available', 'speaking', 0, { room: 'room', participantId: 'j-ann' });
      actions.callParticipantJoined('j-ann', 'Ann J');
      actions.callParticipantJoined('j-x', 'Visitor');
    });
    const call = within(screen.getByRole('list', { name: 'People in your call' }));
    const presence = within(screen.getByRole('list', { name: 'People in HQ' }));
    expect(screen.getByRole('img', { name: '3 in call' })).toBeTruthy();
    expect(call.getAllByRole('listitem').map((li) => li.querySelector('.truncate')?.textContent)).toEqual(['You', 'Ann', 'Visitor']);
    expect(call.getByRole('img', { name: 'Speaking' })).toBeTruthy();
    expect(call.getByRole('img', { name: 'Muted' })).toBeTruthy();
    expect(call.getByRole('button', { name: 'Go to Ann' })).toBeTruthy();
    expect(presence.getByText('Ann')).toBeTruthy();
    expect(presence.queryByRole('img', { name: 'Speaking' })).toBeNull();
  });
});
