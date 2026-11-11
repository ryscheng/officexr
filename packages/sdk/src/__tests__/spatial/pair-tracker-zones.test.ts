import { describe, it, expect } from 'vitest';
import { createBus } from '../../game-state/bus.ts';
import type { PlayerState, VoiceZone } from '../../game-state/types.ts';
import { PairTracker } from '../../spatial/pair-tracker.ts';
import { tickProximity } from '../../spatial/tick-proximity.ts';

const settings = { charRadius: 0.3, proximityRadius: 1.5, proximityOuterRadius: 3, proximityEnterDebounceMs: 300 };
const zone: VoiceZone = { id: 'desk', label: 'Desk', min: { x: 0, z: 0 }, max: { x: 4, z: 4 } };

const player = (id: string, x: number): PlayerState =>
  ({ id, pos: { x, y: 0, z: 2 }, vel: { x: 0, y: 0, z: 0 } }) as PlayerState;

function world() {
  const bus = createBus();
  const events: string[] = [];
  for (const kind of ['proximity:entering', 'proximity:entered', 'proximity:exiting', 'proximity:exited'] as const) {
    bus.on(kind, ({ otherId }) => events.push(`${kind.slice('proximity:'.length)} ${otherId}`));
  }
  const tracker = new PairTracker();
  let now = 0;
  const frames = (players: PlayerState[], n = 30) => {
    for (let i = 0; i < n; i++) {
      now += 16;
      tickProximity(tracker, {
        players: Object.fromEntries(players.map((p) => [p.id, p])),
        voiceZones: [zone],
        selfId: 'alice',
        bus,
        settings: settings as never,
        nowMs: now,
        dtSec: 0.016,
      });
    }
  };
  return { events, frames };
}

describe('tickProximity with voice zones', () => {
  it('pairs two nearby players outside every zone', () => {
    const w = world();
    w.frames([player('alice', 6), player('bob', 7)]);
    expect(w.events).toContain('entered bob');
  });

  it('never pairs a player standing next to someone inside a zone, either way', () => {
    const outside = world();
    outside.frames([player('alice', 5), player('bob', 3.5)]);
    expect(outside.events).toEqual([]);
    const inside = world();
    inside.frames([player('alice', 3.5), player('bob', 5)]);
    expect(inside.events).toEqual([]);
  });

  it('ends a conversation, with no new entry, when a member steps into a zone', () => {
    const w = world();
    w.frames([player('alice', 6), player('bob', 5), player('carol', 6.5)]);
    w.events.length = 0;
    w.frames([player('alice', 6), player('bob', 3.5), player('carol', 6.5)]);
    expect(w.events).toEqual(['exiting bob', 'exited bob']);
  });
});
