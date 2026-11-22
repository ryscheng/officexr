import type { Actions, DeskClaimant, EmoteId, PingIntent, PlacedProp, PlayerId, PlayerState, Store, VoiceZone } from '@officexr/sdk';
import { PREVIEW_ZONES } from './previewMissions';

export const SELF_ID = 'avery@example.test';
export const SELF_NAME = 'Avery Preview';

/** Metres east and south of the map's single spawn point (12, 12), so seeded players stand near the camera. */
const SPAWN = { x: 12, z: 12 };

type Seed = Partial<PlayerState> & { id: PlayerId; name: string; at: [number, number] };

export interface Scenario {
  id: string;
  title: string;
  self: Partial<PlayerState>;
  players: Seed[];
  chat: { from: PlayerId; text: string }[];
  call: string[];
  props: PlacedProp[];
  /** The wand's next spell, and the player it is hitting. */
  spellOn?: { target: PlayerId; caster: PlayerId };
  emotes?: { from: PlayerId; emote: EmoteId }[];
  poke?: PlayerId;
  pings?: { from: PlayerId; intent?: PingIntent }[];
  /** Accessible names clicked in order once the HUD is up, so a scenario can open a panel. */
  steps?: string[];
  /** Desks in metres east and south of the spawn point, each with a chair and its claimant. */
  desks?: { id: string; at: [number, number]; login: string; claimant?: DeskClaimant }[];
  /** Map objects, in metres east and south of the spawn point; an object's position is its lowest corner. */
  furniture?: { id: string; kindId: string; at: [number, number] }[];
  /** Rooms for the mission places and the map; the seed replaces the map's own zones. */
  zones?: VoiceZone[];
  missions?: 'seeded' | 'empty' | 'unsupported';
  textOnly?: boolean;
}

const prop = (n: number, kindId: PlacedProp['kindId'], x: number, z: number, yawDeg = 0): PlacedProp => ({
  id: `placed:${n}`,
  kindId,
  position: [x, 1, z],
  yawDeg,
});

const PROPS: PlacedProp[] = [
  prop(1, 'prop_pool', 15, 6),
  prop(2, 'prop_scooter_rack', 9, 14),
  prop(3, 'prop_tricycle_rack', 8, 10),
  prop(4, 'prop_wand_stand', 13, 15),
];

const VOXEL_M = 0.5;
const FLOOR_VOXEL_Y = 2;

const propNear = (n: number, kindId: PlacedProp['kindId'], dx: number, dz: number, yawDeg = 0): PlacedProp => ({
  id: `placed:${n}`,
  kindId,
  position: [(SPAWN.x + dx) / VOXEL_M, FLOOR_VOXEL_Y, (SPAWN.z + dz) / VOXEL_M],
  yawDeg,
});

const NAMES = [
  'Bao Tran',
  'Chiamaka Okonkwo-Adeyemi',
  'Dmitri Volkov',
  'Esperanza Villanueva Montoya',
  'Fatima Al-Sayed',
  'Gustavo Ferreira',
  'Hana Kobayashi',
  'Ines Moreau',
  'Jamal Washington',
  'Kiri Te Rangi',
  'Lars Lindqvist',
  'Mei Chen',
];

const crowd: Seed[] = [
  { id: 'bao@example.test', name: 'Bao Tran', at: [-2, -1], statusText: 'Reviewing the Q3 roadmap', statusEmoji: '📋', handRaised: true },
  {
    id: 'chiamaka@example.test',
    name: 'Chiamaka Okonkwo-Adeyemi',
    at: [3, -2],
    statusText: 'In a deep work block until 15:00, ping me only if it is urgent',
    statusEmoji: '🎧',
    focus: true,
  },
  { id: 'dmitri@example.test', name: 'Dmitri Volkov', at: [1, 2], pose: 'scooter', poseRack: 'placed:2' },
  { id: 'esperanza@example.test', name: 'Esperanza Villanueva Montoya', at: [4, -6], pose: 'swim', statusText: 'Pool break' },
  { id: 'fatima@example.test', name: 'Fatima Al-Sayed', at: [-4, 3], status: 'away', statusText: 'Lunch' },
  { id: 'gustavo@example.test', name: 'Gustavo Ferreira', at: [-1, -4], held: 'wand', heldStand: 'placed:4' },
];

const chat = [
  { from: 'bao@example.test', text: 'Standup in 5, grab a seat' },
  { from: SELF_ID, text: 'On my way' },
  { from: 'chiamaka@example.test', text: 'Here is the link: https://example.test/a/very/long/url/that/does/not/break/anywhere/at-all' },
];

export const SCENARIOS: Record<string, Scenario> = {
  crowd: {
    id: 'crowd',
    zones: PREVIEW_ZONES,
    missions: 'seeded',
    title: 'Busy office',
    self: { statusText: 'Heads down on the HUD', statusEmoji: '🛠️' },
    players: crowd,
    chat,
    call: ['Bao Tran', 'Dmitri Volkov', 'Fatima Al-Sayed'],
    props: PROPS,
    emotes: [{ from: 'fatima@example.test', emote: 'party' }],
    poke: 'bao@example.test',
  },
  missions: {
    id: 'missions',
    title: 'Missions, one current, near a person',
    self: { statusText: 'Heads down on the HUD', statusEmoji: '🛠️' },
    players: [...crowd.slice(0, 3), { id: 'ines@example.test', name: 'Ines Moreau', at: [2, 1] }],
    chat: [{ from: 'bao@example.test', text: 'Lunch at 12?' }],
    call: ['Bao Tran'],
    props: PROPS,
    zones: PREVIEW_ZONES,
    missions: 'seeded',
    steps: ['Go to Meeting room 1'],
  },
  chat: {
    id: 'chat',
    title: 'Chat with a few messages, someone near',
    self: {},
    players: crowd.slice(0, 3),
    chat,
    call: [],
    props: PROPS,
    zones: PREVIEW_ZONES,
    missions: 'seeded',
  },
  'new-mission': {
    id: 'new-mission',
    title: 'New mission form open',
    self: {},
    players: crowd.slice(0, 3),
    chat: [],
    call: [],
    props: PROPS,
    zones: PREVIEW_ZONES,
    missions: 'seeded',
  },
  'missions-old-server': {
    id: 'missions-old-server',
    title: 'Server without the missions API',
    self: {},
    players: crowd.slice(0, 2),
    chat: [],
    call: [],
    props: [],
    missions: 'unsupported',
  },
  frozen: {
    id: 'frozen',
    title: 'Three desks, one claimant present',
    self: {},
    players: crowd.slice(0, 1),
    chat: [],
    call: [],
    props: [],
    desks: [
      { id: 'desk-a', at: [-3, 1], login: 'bao@example.test', claimant: { characterId: 'Knight' } },
      { id: 'desk-b', at: [-1, 1], login: 'ines.moreau@example.test', claimant: { characterId: 'Mage' } },
      { id: 'desk-c', at: [1, 1], login: 'lars@example.test' },
    ],
  },
  'text-only': {
    id: 'text-only',
    zones: PREVIEW_ZONES,
    missions: 'seeded',
    title: 'In a call with voice unavailable',
    self: {},
    players: crowd.slice(0, 3),
    chat: chat.slice(0, 1),
    call: [],
    props: PROPS,
    textOnly: true,
  },
  ping: {
    id: 'ping',
    title: 'A ping from a person who is not near',
    self: {},
    players: [{ id: 'bao@example.test', name: 'Bao Tran', at: [-9, -6] }, ...crowd.slice(2, 3)],
    chat: [],
    call: [],
    props: [],
    pings: [{ from: 'bao@example.test' }],
  },
  invite: {
    id: 'invite',
    title: 'An invitation to talk from a person who is not near',
    self: {},
    players: [{ id: 'bao@example.test', name: 'Bao Tran', at: [-9, -6] }],
    chat: [],
    call: [],
    props: [],
    pings: [{ from: 'bao@example.test', intent: 'invite' }],
  },
  wave: {
    id: 'wave',
    title: 'A wave from a person who is not near',
    self: {},
    players: [{ id: 'bao@example.test', name: 'Bao Tran', at: [-9, -6] }],
    chat: [],
    call: [],
    props: [],
    pings: [{ from: 'bao@example.test', intent: 'wave' }],
  },
  near: {
    id: 'near',
    title: 'One person two metres away, no chat',
    self: {},
    players: [{ id: 'bao@example.test', name: 'Bao Tran', at: [2, 1] }],
    chat: [],
    call: [],
    props: [],
  },
  spread: {
    id: 'spread',
    title: 'Two people far from the camera',
    self: {},
    players: [
      { id: 'bao@example.test', name: 'Bao Tran', at: [11, 9] },
      { id: 'ines@example.test', name: 'Ines Moreau', at: [-10, -11] },
    ],
    chat: [],
    call: [],
    props: [],
  },
  'interact-seat': {
    id: 'interact-seat',
    title: 'A free desk chair',
    self: {},
    players: [],
    chat: [],
    call: [],
    props: [],
    desks: [{ id: 'desk-a', at: [3, 0], login: '' }],
  },
  'interact-couch': {
    id: 'interact-couch',
    title: 'A couch',
    self: {},
    players: [],
    chat: [],
    call: [],
    props: [],
    furniture: [{ id: 'couch-a', kindId: 'furniture_couch', at: [3, 0] }],
  },
  'interact-rack': {
    id: 'interact-rack',
    title: 'A scooter rack',
    self: {},
    players: [],
    chat: [],
    call: [],
    props: [propNear(2, 'prop_scooter_rack', 3, 0)],
  },
  'interact-wand': {
    id: 'interact-wand',
    title: 'The wand stand',
    self: {},
    players: [],
    chat: [],
    call: [],
    props: [propNear(4, 'prop_wand_stand', 3, 0)],
  },
  alone: {
    id: 'alone',
    title: 'Empty office',
    self: {},
    players: [],
    chat: [],
    call: [],
    props: [],
  },
  wand: {
    id: 'wand',
    zones: PREVIEW_ZONES,
    missions: 'seeded',
    title: 'Wand held, spell active',
    self: { held: 'wand', heldStand: 'placed:4' },
    players: crowd,
    chat: chat.slice(0, 1),
    call: ['Bao Tran'],
    props: PROPS,
    spellOn: { target: 'dmitri@example.test', caster: SELF_ID },
  },
  build: {
    id: 'build',
    zones: PREVIEW_ZONES,
    missions: 'seeded',
    title: 'Build panel open',
    self: {},
    players: crowd.slice(0, 3),
    chat: chat.slice(0, 2),
    call: ['Bao Tran', 'Dmitri Volkov'],
    props: PROPS,
    steps: ['Build'],
  },
  focus: {
    id: 'focus',
    zones: PREVIEW_ZONES,
    missions: 'seeded',
    title: 'Focus on, hand raised, long status',
    self: {
      focus: true,
      handRaised: true,
      statusEmoji: '🎧',
      statusText: 'Writing the incident review, back at half past three, please leave a message in chat',
    },
    players: crowd,
    chat,
    call: [],
    props: PROPS,
    steps: ['Ping Chiamaka Okonkwo-Adeyemi'],
  },
  full: {
    id: 'full',
    zones: PREVIEW_ZONES,
    missions: 'seeded',
    title: 'Full roster, long names, full call',
    self: { statusText: 'Presenting', statusEmoji: '🎤' },
    players: [
      ...crowd,
      ...NAMES.map<Seed>((name, i) => ({
        id: `p${i}@example.test`,
        name,
        at: [(i % 4) * 2 - 3, Math.floor(i / 4) * 2 - 8],
        statusText: i % 3 === 0 ? 'Out for a walk' : null,
        handRaised: i % 5 === 0,
        focus: i % 4 === 1,
      })),
    ],
    chat: [...chat, ...Array.from({ length: 12 }, (_, i) => ({ from: `p${i % 12}@example.test`, text: `Message number ${i + 1}` }))],
    call: NAMES.slice(0, 9),
    props: PROPS,
  },
};

export const scenarioIds = Object.keys(SCENARIOS);

export function getScenario(id: string | null): Scenario {
  return (id && SCENARIOS[id]) || SCENARIOS.crowd;
}

const NOW = () => performance.now();

/** Puts the scenario into the store; remote players are written directly, as a snapshot handshake would. */
export function seedScenario(scenario: Scenario, deps: { store: Store; actions: Actions }): () => void {
  const { store, actions } = deps;
  const now = NOW();
  actions.upsertPlayer({ id: SELF_ID, name: SELF_NAME, ...scenario.self });
  for (const { at, ...p } of scenario.players) {
    actions.upsertPlayer({
      ...p,
      pos: { x: SPAWN.x + at[0], y: 2, z: SPAWN.z + at[1] },
      yaw: ((at[0] * 31) % 6) - 3,
      avatar: { model: 'Knight' },
      firstSeenAt: now,
      lastStatusAt: now,
      lastActiveAt: now,
    });
  }
  actions.setPlacedProps(scenario.props);
  if (scenario.textOnly) actions.setMyJitsiRoom('hud-preview-room');
  const unseedZones = scenario.zones ? seedZones(scenario.zones, deps) : () => {};
  const unseedFurniture = scenario.furniture ? seedFurniture(scenario.furniture, deps) : () => {};
  const unseedDesks = scenario.desks ? seedDesks(scenario.desks, deps) : () => {};
  scenario.chat.forEach((m, i) =>
    actions.applyRemoteChat({ id: `m${i}`, authorId: m.from, text: m.text, t: Date.now() - (scenario.chat.length - i) * 60_000 }),
  );
  scenario.call.forEach((name, i) => actions.callParticipantJoined(`call-${i}`, name));
  store.setState(() => ({ realtime: { ...store.getState().realtime, status: 'live' } }));

  const timers: ReturnType<typeof setInterval>[] = [];
  const replay = () => {
    const t = NOW();
    for (const e of scenario.emotes ?? []) actions.receiveEmote(e.from, e.emote, t);
    if (scenario.poke) actions.receivePoke(scenario.poke, SELF_ID, t);
    for (const p of scenario.pings ?? []) actions.receivePing(p.from, t, p.intent);
    if (scenario.spellOn) {
      actions.receiveSpellCast(scenario.spellOn.caster, {
        spell: 'levitate',
        origin: { x: SPAWN.x, y: 3, z: SPAWN.z },
        dir: { x: 0, y: 0, z: 1 },
        distance: 1,
        targetId: scenario.spellOn.target,
      }, t);
    }
  };
  replay();
  timers.push(setInterval(replay, 2000));
  return () => {
    timers.forEach(clearInterval);
    unseedDesks();
    unseedFurniture();
    unseedZones();
  };
}

/** Seeds the rooms, and again whenever the map load replaces them. */
function seedZones(zones: VoiceZone[], { store, actions }: { store: Store; actions: Actions }): () => void {
  const apply = () => {
    if (store.getState().voiceZones !== zones) actions.setVoiceZones(zones);
  };
  apply();
  return store.subscribe((s) => s.voiceZones, apply);
}

function seedFurniture(furniture: NonNullable<Scenario['furniture']>, { store, actions }: { store: Store; actions: Actions }): () => void {
  const apply = () => {
    const { cubeSize, instances } = store.getState().worldObjects;
    if (furniture.every((f) => instances.some((i) => i.id === f.id))) return;
    const placed = furniture.map((f) => ({
      id: f.id,
      sourceCommandId: f.id,
      kindId: f.kindId,
      position: [(SPAWN.x + f.at[0]) / cubeSize, FLOOR_VOXEL_Y, (SPAWN.z + f.at[1]) / cubeSize] as [number, number, number],
      yawDeg: 0,
    }));
    actions.setWorldObjects({ cubeSize, instances: [...instances, ...placed] });
  };
  apply();
  return store.subscribe((s) => s.worldObjects, apply);
}

const DESK_CHAIR_KIND = 'furniture_chair_a';

/** Seeds chairs, desk areas and claims, and re-seeds them whenever the map load replaces them. */
function seedDesks(desks: NonNullable<Scenario['desks']>, { store, actions }: { store: Store; actions: Actions }): () => void {
  const ready = () => {
    const s = store.getState();
    return desks.every((d) => s.deskAreas.some((a) => a.id === d.id) && s.worldObjects.instances.some((i) => i.id === `chair-${d.id}`));
  };
  let applying = false;
  const apply = () => {
    if (applying || ready()) return;
    applying = true;
    const { cubeSize, instances } = store.getState().worldObjects;
    const chairs = desks.map((d) => ({
      id: `chair-${d.id}`,
      sourceCommandId: `chair-${d.id}`,
      kindId: DESK_CHAIR_KIND,
      position: [Math.round((SPAWN.x + d.at[0]) / cubeSize), Math.round(1 / cubeSize), Math.round((SPAWN.z + d.at[1]) / cubeSize)] as [number, number, number],
      yawDeg: 180,
    }));
    actions.setWorldObjects({ cubeSize, instances: [...instances.filter((i) => !i.id.startsWith('chair-desk-')), ...chairs] });
    actions.setDeskAreas(
      desks.map((d) => ({
        id: d.id,
        label: d.id,
        min: { x: SPAWN.x + d.at[0] - 1, z: SPAWN.z + d.at[1] - 1 },
        max: { x: SPAWN.x + d.at[0] + 1, z: SPAWN.z + d.at[1] + 1 },
        seatInstanceId: `chair-${d.id}`,
      })),
    );
    actions.setDeskClaims(
      Object.fromEntries(desks.filter((d) => d.login !== '').map((d) => [d.id, d.login])),
      Object.fromEntries(desks.flatMap((d) => (d.claimant ? [[d.login, d.claimant]] : []))),
    );
    applying = false;
  };
  apply();
  const unsubscribe = [
    store.subscribe((s) => s.deskAreas, apply),
    store.subscribe((s) => s.worldObjects, apply),
  ];
  return () => unsubscribe.forEach((u) => u());
}
