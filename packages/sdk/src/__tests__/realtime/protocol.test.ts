import { describe, it, expect } from 'vitest';
import {
  PROTOCOL,
  validateNetEvent,
  versionMismatch,
  type NetEvent,
} from '../../realtime/protocol.ts';
import { DEFAULT_WORLD_CONSTANTS } from '../../game-state/world-constants.ts';

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
      isAirborne: false,
    },
    { kind: 'chat:message', v: 1, actorId: 'a', seq: 1, t: 0, text: 'hi' },
    { kind: 'presence:status', v: 1, actorId: 'a', seq: 1, t: 0, status: 'away', mic: 'muted' },
    {
      kind: 'avatar:update',
      v: 1,
      actorId: 'a',
      seq: 1,
      t: 0,
      avatar: { model: 'gnome' },
      name: 'A',
    },
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
        worldMap: {
          gridSize: 50,
          cubeSize: 2,
          origin: { x: 0, z: 0 },
          layers: [],
          kinds: { floor: { id: 'floor', walkable: true } },
        },
        characterConfigs: {},
        worldObjects: { cubeSize: 2, instances: [] },
      },
      seqTable: { leader: 5 },
    },
    {
      kind: 'world:constants',
      v: 1,
      actorId: 'server',
      seq: 1,
      t: 0,
      constants: DEFAULT_WORLD_CONSTANTS,
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
          wall: { id: 'wall', walkable: false, appearance: { color: '#888' } },
        },
      },
    },
    {
      kind: 'world:characters',
      v: 1,
      actorId: 'a',
      seq: 1,
      t: 0,
      configs: {
        Mage: { speedMultiplier: 0.7, walkAnimSpeed: 0.9 },
        Knight: { charRadius: 0.5 },
      },
    },
    {
      kind: 'world:objects',
      v: 1,
      actorId: 'a',
      seq: 1,
      t: 0,
      objects: {
        cubeSize: 2,
        instances: [
          {
            id: 'i:cmd1:0,0,0',
            sourceCommandId: 'cmd1',
            kindId: 'colored_block_blue',
            position: [0, 0, 0],
          },
        ],
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
      expect(def.authority).toMatch(/^(local|host|server)$/);
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

function makeWorldConstantsEvent(constants: unknown) {
  return { kind: 'world:constants', v: 1, actorId: 'server', seq: 1, t: 0, constants };
}

function withSection(section: string, patch: Record<string, unknown>) {
  const c = structuredClone(DEFAULT_WORLD_CONSTANTS) as unknown as Record<string, Record<string, unknown>>;
  c[section] = { ...c[section], ...patch };
  return c;
}

describe('world:constants', () => {
  it('is the only world-settings carrier in the protocol', () => {
    expect(PROTOCOL['world:constants'].authority).toBe('server');
    expect(Object.keys(PROTOCOL)).not.toContain('world:settings');
  });

  it.each([
    ['jump', { airControl: 1.5 }],
    ['jump', { jumpVelocity: 0 }],
    ['jump', { maxJumps: 0 }],
    ['animation', { movementBlockThreshold: 2 }],
    ['proximity', { enteredColor: 'green' }],
    ['lighting', { sunPosition: [1, 2] }],
    ['fixedCamera', { fov: 0 }],
  ])('rejects out-of-range %s %o', (section, patch) => {
    const r = validateNetEvent(makeWorldConstantsEvent(withSection(section, patch)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('schema');
  });

  it('rejects a document missing a field', () => {
    const c = structuredClone(DEFAULT_WORLD_CONSTANTS) as unknown as Record<string, Record<string, unknown>>;
    delete c.lighting!.sunColor;
    expect(validateNetEvent(makeWorldConstantsEvent(c)).ok).toBe(false);
  });

  it('rejects a document missing a section or schemaVersion', () => {
    const { background: _bg, ...noBackground } = DEFAULT_WORLD_CONSTANTS;
    const { schemaVersion: _v, ...noVersion } = DEFAULT_WORLD_CONSTANTS;
    expect(validateNetEvent(makeWorldConstantsEvent(noBackground)).ok).toBe(false);
    expect(validateNetEvent(makeWorldConstantsEvent(noVersion)).ok).toBe(false);
  });
});

function makePresencePositionEvent(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'presence:position',
    v: 1,
    actorId: 'alice',
    seq: 1,
    t: 0,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    isAirborne: false,
    ...overrides,
  };
}

describe('presence:status', () => {
  const base = { kind: 'presence:status', v: 1, actorId: 'a', seq: 1, t: 0, status: 'available', mic: 'none' };

  it.each([
    ['status', { status: 'active' }],
    ['mic', { mic: 'loud' }],
  ])('rejects an invalid %s', (_field, patch) => {
    const r = validateNetEvent({ ...base, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('schema');
  });
});

describe('presence:position — isAirborne field', () => {
  it('accepts isAirborne: false', () => {
    const r = validateNetEvent(makePresencePositionEvent({ isAirborne: false }));
    expect(r.ok).toBe(true);
  });

  it('accepts isAirborne: true', () => {
    const r = validateNetEvent(makePresencePositionEvent({ isAirborne: true }));
    expect(r.ok).toBe(true);
  });

  it('rejects missing isAirborne', () => {
    const { isAirborne: _, ...noAirborne } = makePresencePositionEvent();
    const r = validateNetEvent(noAirborne);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('schema');
  });

  it('rejects avatar:update without a name', () => {
    const result = validateNetEvent({
      kind: 'avatar:update',
      v: 1,
      actorId: 'a',
      seq: 1,
      t: 0,
      avatar: { model: 'gnome' },
    });
    expect(result.ok).toBe(false);
  });
});
