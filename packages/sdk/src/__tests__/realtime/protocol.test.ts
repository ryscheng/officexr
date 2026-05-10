import { describe, it, expect } from 'vitest';
import {
  PROTOCOL,
  validateNetEvent,
  versionMismatch,
  type NetEvent,
} from '../../realtime/protocol.ts';

describe('PROTOCOL table', () => {
  const SAMPLE_EVENTS: NetEvent[] = [
    {
      kind: 'presence:position',
      v: 1,
      actorId: 'alice',
      seq: 1,
      t: 0,
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      yaw: 0,
    },
    { kind: 'chat:message', v: 1, actorId: 'a', seq: 1, t: 0, text: 'hi' },
    { kind: 'avatar:update', v: 1, actorId: 'a', seq: 1, t: 0, avatar: { model: 'gnome' } },
    {
      kind: 'whiteboard:stroke',
      v: 1,
      actorId: 'a',
      seq: 1,
      t: 0,
      stroke: {
        id: 's',
        authorId: 'a',
        points: [{ x: 0, y: 0 }],
        color: '#000',
        width: 1,
        t: 0,
      },
    },
    {
      kind: 'shot:hit',
      v: 1,
      actorId: 'a',
      seq: 1,
      t: 0,
      targetId: 'b',
      dmg: 10,
    },
    {
      kind: 'zombie:state',
      v: 1,
      actorId: 'host',
      seq: 1,
      t: 0,
      state: {
        phase: 'wave',
        wave: 1,
        totalKills: 0,
        hostId: 'host',
        entities: {},
        playerHealths: {},
      },
    },
    { kind: 'snapshot:request', v: 1, actorId: 'a', seq: 1, t: 0 },
    {
      kind: 'snapshot:offer',
      v: 1,
      actorId: 'leader',
      seq: 1,
      t: 0,
      target: 'a',
      state: {
        selfId: 'leader',
        officeId: 'r',
        players: {},
        proximity: {},
        chat: [],
        whiteboard: { strokes: [], cleared: 0 },
        zombies: {
          phase: 'idle',
          wave: 0,
          totalKills: 0,
          hostId: null,
          entities: {},
          playerHealths: {},
        },
        inventory: [],
        screenShares: {},
        realtime: { status: 'live', snapshotTarget: null, versionWarnings: {} },
        runtime: { tickRate: 60, lastTick: 0, protocolVersion: 1 },
        worldSettings: {
          playerSpeed: 3,
          runSpeedMultiplier: 2,
          walkAnimSpeed: 1,
          runAnimSpeed: 1,
          idleAnimSpeed: 1,
          turnSpeed: 16,
          charRadius: 0.4,
          proximityRadius: 3,
          proximityOuterRadius: 6,
          bumpEasingMs: 180,
          movementBlockThreshold: 0.9,
        },
        worldMap: {
          gridSize: 50,
          cubeSize: 2,
          origin: { x: 0, z: 0 },
          layers: [],
          kinds: { floor: { id: 'floor', walkable: true } },
        },
      },
      seqTable: { leader: 5 },
    },
    {
      kind: 'world:settings',
      v: 1,
      actorId: 'a',
      seq: 1,
      t: 0,
      settings: {
        playerSpeed: 4,
        runSpeedMultiplier: 2.5,
        walkAnimSpeed: 1.2,
        runAnimSpeed: 1.0,
        idleAnimSpeed: 0.8,
        turnSpeed: 20,
        charRadius: 0.4,
        proximityRadius: 3,
        proximityOuterRadius: 6,
        bumpEasingMs: 180,
        movementBlockThreshold: 0.9,
      },
    },
    {
      kind: 'world:map',
      v: 1,
      actorId: 'a',
      seq: 1,
      t: 0,
      map: {
        gridSize: 4,
        cubeSize: 2,
        origin: { x: 0, z: 0 },
        layers: [{ kind: 'wall', cells: [{ i: 0, j: 0 }] }],
        kinds: {
          floor: { id: 'floor', walkable: true },
          wall: { id: 'wall', walkable: false },
        },
      },
    },
  ];

  it('every NetEvent kind has an entry in PROTOCOL with v + schema + authority', () => {
    const sampleKinds = new Set(SAMPLE_EVENTS.map((e) => e.kind));
    const protocolKinds = new Set(Object.keys(PROTOCOL));
    // every kind we have a sample for must be in PROTOCOL
    for (const k of sampleKinds) {
      expect(PROTOCOL[k as keyof typeof PROTOCOL]).toBeDefined();
    }
    // every kind in PROTOCOL must have all three fields
    for (const [kind, def] of Object.entries(PROTOCOL)) {
      expect(def.v).toBeGreaterThan(0);
      expect(def.schema).toBeDefined();
      expect(def.authority).toMatch(/^(local|host)$/);
      expect(protocolKinds.has(kind)).toBe(true);
    }
  });

  it('validateNetEvent accepts valid envelope-bearing events', () => {
    for (const e of SAMPLE_EVENTS) {
      const r = validateNetEvent(e);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.event.kind).toBe(e.kind);
    }
  });

  it('validateNetEvent rejects unknown kinds', () => {
    const bad = { kind: 'totally-made-up', v: 1, actorId: 'a', seq: 1, t: 0 };
    const r = validateNetEvent(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown-kind');
  });

  it('validateNetEvent rejects missing envelope fields', () => {
    const bad = { kind: 'chat:message', v: 1, text: 'hi' };
    const r = validateNetEvent(bad);
    expect(r.ok).toBe(false);
  });

  it('validateNetEvent rejects malformed payloads', () => {
    const bad = { kind: 'chat:message', v: 1, actorId: 'a', seq: 1, t: 0, text: 42 };
    const r = validateNetEvent(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('schema');
  });

  it('versionMismatch detects mismatch', () => {
    expect(
      versionMismatch({
        kind: 'chat:message',
        v: 999,
        actorId: 'a',
        seq: 1,
        t: 0,
        text: 'hi',
      } as unknown as NetEvent),
    ).toBe(true);
    expect(
      versionMismatch({
        kind: 'chat:message',
        v: 1,
        actorId: 'a',
        seq: 1,
        t: 0,
        text: 'hi',
      }),
    ).toBe(false);
  });
});
