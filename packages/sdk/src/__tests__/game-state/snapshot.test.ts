import { describe, it, expect } from 'vitest';
import { createInitialOfficeState } from '../../game-state/store.ts';
import { serializeOfficeState, applySnapshot } from '../../game-state/snapshot.ts';

describe('snapshot', () => {
  it('roundtrips players, chat, whiteboard, zombies', () => {
    const s = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
    s.players['me'] = {
      id: 'me',
      name: 'Me',
      pos: { x: 1, y: 2, z: 3 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0.5,
      hp: 75,
      isDead: false,
      avatar: { model: 'gnome' },
      jitsiRoom: null,
      status: 'active',
    };
    s.chat = [{ id: 'm1', authorId: 'me', text: 'hi', t: 100 }];
    s.whiteboard.strokes.push({
      id: 's1',
      authorId: 'me',
      points: [{ x: 0, y: 0 }],
      color: '#000',
      width: 1,
      t: 0,
    });
    s.zombies = {
      phase: 'wave',
      wave: 3,
      totalKills: 7,
      hostId: 'me',
      entities: { z1: { id: 'z1', pos: { x: 0, y: 0, z: 0 }, hp: 50, target: 'me' } },
      playerHealths: { me: 75 },
    };
    s.proximity = { me: new Set(['friend']) };

    const wire = serializeOfficeState(s);
    const json = JSON.parse(JSON.stringify(wire));
    const restored = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
    applySnapshot(restored, json);

    expect(restored.players.me.hp).toBe(75);
    expect(restored.chat).toHaveLength(1);
    expect(restored.whiteboard.strokes).toHaveLength(1);
    expect(restored.zombies.wave).toBe(3);
    expect(restored.zombies.entities['z1'].hp).toBe(50);
    expect(restored.proximity.me).toBeInstanceOf(Set);
    expect(restored.proximity.me.has('friend')).toBe(true);
  });

  it('strips MediaStream references on serialize', () => {
    const s = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
    s.screenShares = {
      bob: { ownerId: 'bob', stream: { fakeStream: true }, signalState: 'connected' },
    };
    const wire = serializeOfficeState(s);
    expect(wire.screenShares['bob'].stream).toBeNull();
  });

  it('resets receiver-only tRecv on apply', () => {
    const s = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
    s.players['remote'] = {
      id: 'remote',
      name: 'R',
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
      hp: 100,
      isDead: false,
      avatar: { model: 'default' },
      jitsiRoom: null,
      status: 'active',
      tRecv: 99999,
    };
    const wire = serializeOfficeState(s);
    const restored = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
    applySnapshot(restored, JSON.parse(JSON.stringify(wire)));
    expect(restored.players.remote.tRecv).toBeUndefined();
  });

  it('round-trips proximity Sets as arrays on the wire', () => {
    const s = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
    s.proximity = { me: new Set(['a', 'b']) };
    const wire = serializeOfficeState(s);
    expect(Array.isArray((wire.proximity as any).me)).toBe(true);
    expect(((wire.proximity as any).me as string[]).sort()).toEqual(['a', 'b']);
  });

  it('serialized form is JSON-clonable', () => {
    const s = createInitialOfficeState({ selfId: 'me', officeId: 'r' });
    const wire = serializeOfficeState(s);
    expect(() => JSON.parse(JSON.stringify(wire))).not.toThrow();
  });
});
