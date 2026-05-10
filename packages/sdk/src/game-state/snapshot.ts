import type { OfficeState, PlayerState, ScreenShareSignal } from './types.ts';

// JSON-shaped serialization of OfficeState. Sets become arrays. MediaStream
// references are stripped (re-established via WebRTC after apply).
export type SerializedOfficeState = Omit<OfficeState, 'proximity' | 'players' | 'screenShares'> & {
  players: Record<string, Omit<PlayerState, 'tRecv'>>;
  proximity: Record<string, string[]>;
  screenShares: Record<string, Omit<ScreenShareSignal, 'stream'> & { stream: null }>;
};

export function serializeOfficeState(state: OfficeState): SerializedOfficeState {
  const players: SerializedOfficeState['players'] = {};
  for (const [id, p] of Object.entries(state.players)) {
    const { tRecv: _tRecv, ...rest } = p;
    players[id] = rest;
  }

  const proximity: Record<string, string[]> = {};
  for (const [id, set] of Object.entries(state.proximity)) {
    proximity[id] = Array.from(set);
  }

  const screenShares: SerializedOfficeState['screenShares'] = {};
  for (const [id, share] of Object.entries(state.screenShares)) {
    screenShares[id] = { ...share, stream: null };
  }

  return {
    selfId: state.selfId,
    officeId: state.officeId,
    players,
    proximity,
    chat: state.chat,
    whiteboard: state.whiteboard,
    zombies: state.zombies,
    inventory: state.inventory,
    screenShares,
    realtime: state.realtime,
    runtime: state.runtime,
    worldSettings: state.worldSettings,
    worldMap: state.worldMap,
  };
}

// Apply a snapshot to an existing in-memory store target. Mutates `target`
// in place (callers wrap this in store.setState()).
export function applySnapshot(target: OfficeState, snap: SerializedOfficeState): void {
  // self-related fields preserved on the receiver
  const selfId = target.selfId;
  const officeId = target.officeId;

  target.players = {};
  for (const [id, p] of Object.entries(snap.players)) {
    target.players[id] = { ...p }; // tRecv intentionally omitted
  }

  target.proximity = {};
  for (const [id, list] of Object.entries(snap.proximity)) {
    target.proximity[id] = new Set(list);
  }

  target.chat = [...snap.chat];
  target.whiteboard = {
    strokes: [...snap.whiteboard.strokes],
    cleared: snap.whiteboard.cleared,
  };
  target.zombies = {
    ...snap.zombies,
    entities: { ...snap.zombies.entities },
    playerHealths: { ...snap.zombies.playerHealths },
  };
  target.inventory = [...snap.inventory];

  target.screenShares = {};
  for (const [id, share] of Object.entries(snap.screenShares)) {
    target.screenShares[id] = { ...share, stream: null };
  }

  target.realtime = { ...snap.realtime };
  target.runtime = { ...snap.runtime };
  target.worldSettings = { ...snap.worldSettings };
  target.worldMap = {
    gridSize: snap.worldMap.gridSize,
    cubeSize: snap.worldMap.cubeSize,
    origin: { ...snap.worldMap.origin },
    layers: snap.worldMap.layers.map((l) => ({
      kind: l.kind,
      cells: l.cells.map((c) => ({ i: c.i, j: c.j })),
    })),
    kinds: Object.fromEntries(
      Object.entries(snap.worldMap.kinds).map(([id, k]) => [id, { ...k }]),
    ),
  };
  target.selfId = selfId;
  target.officeId = officeId;
}
