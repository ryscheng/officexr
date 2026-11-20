import type { Actions, Bus, EmoteId, PlacedProp, PlayerId, PlayerState, Store } from '@officexr/sdk';

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
  /** Accessible names clicked in order once the HUD is up, so a scenario can open a panel. */
  steps?: string[];
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
    title: 'Busy office',
    self: { statusText: 'Heads down on the HUD', statusEmoji: '🛠️' },
    players: crowd,
    chat,
    call: ['Bao Tran', 'Dmitri Volkov', 'Fatima Al-Sayed'],
    props: PROPS,
    emotes: [{ from: 'fatima@example.test', emote: 'party' }],
    poke: 'bao@example.test',
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
export function seedScenario(scenario: Scenario, deps: { store: Store; actions: Actions; bus: Bus }): () => void {
  const { store, actions, bus } = deps;
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
  return () => timers.forEach(clearInterval);
}
