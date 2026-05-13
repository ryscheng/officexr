import { describe, it, expect } from 'vitest';
import { createStore } from '../../game-state/store.ts';
import { createActions } from '../../game-state/actions.ts';

describe('actions.setWorldMapCell', () => {
  function setup() {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const actions = createActions(store);
    // Add a `wall` kind so the test cells are valid.
    actions.setWorldMap({
      ...store.getState().worldMap,
      kinds: {
        floor: { id: 'floor', walkable: true },
        wall: { id: 'wall', walkable: false },
      },
    });
    return { store, actions };
  }

  it('appends a cell to a new layer when the kind has no layer yet', () => {
    const { store, actions } = setup();
    actions.setWorldMapCell(2, 3, 'wall');
    const layers = store.getState().worldMap.layers;
    expect(layers).toHaveLength(1);
    expect(layers[0]).toEqual({ kind: 'wall', cells: [{ i: 2, j: 3 }] });
  });

  it('appends to an existing layer when the kind already has one', () => {
    const { store, actions } = setup();
    actions.setWorldMapCell(0, 0, 'wall');
    actions.setWorldMapCell(1, 1, 'wall');
    const layers = store.getState().worldMap.layers;
    expect(layers).toHaveLength(1);
    expect(layers[0].cells).toEqual([
      { i: 0, j: 0 },
      { i: 1, j: 1 },
    ]);
  });

  it('moves a cell between kinds (strip from old layer, add to new)', () => {
    const { store, actions } = setup();
    actions.setWorldMap({
      ...store.getState().worldMap,
      kinds: {
        floor: { id: 'floor', walkable: true },
        wall: { id: 'wall', walkable: false },
        spawn: { id: 'spawn', walkable: true },
      },
    });
    actions.setWorldMapCell(5, 5, 'wall');
    actions.setWorldMapCell(5, 5, 'spawn');
    const layers = store.getState().worldMap.layers;
    // wall layer should be empty (and dropped); spawn layer should hold (5,5)
    expect(layers.find((l) => l.kind === 'wall')).toBeUndefined();
    expect(layers.find((l) => l.kind === 'spawn')?.cells).toEqual([
      { i: 5, j: 5 },
    ]);
  });

  it('clears a cell when kindId is null and drops the layer if empty', () => {
    const { store, actions } = setup();
    actions.setWorldMapCell(7, 7, 'wall');
    actions.setWorldMapCell(7, 7, null);
    expect(store.getState().worldMap.layers).toEqual([]);
  });

  it('is a no-op when the kindId is unknown', () => {
    const { store, actions } = setup();
    const before = store.getState().worldMap;
    actions.setWorldMapCell(0, 0, 'made-up');
    expect(store.getState().worldMap).toBe(before);
  });
});

describe('actions.setCharacterConfig', () => {
  it('creates a fresh entry when none exists for the model', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const actions = createActions(store);
    actions.setCharacterConfig('Mage', { speedMultiplier: 0.7 });
    expect(store.getState().characterConfigs.Mage).toEqual({
      speedMultiplier: 0.7,
    });
  });

  it('merges patches into the existing entry rather than replacing it', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const actions = createActions(store);
    actions.setCharacterConfig('Mage', { speedMultiplier: 0.7 });
    actions.setCharacterConfig('Mage', { walkAnimSpeed: 1.2 });
    expect(store.getState().characterConfigs.Mage).toEqual({
      speedMultiplier: 0.7,
      walkAnimSpeed: 1.2,
    });
  });

  it('keeps unrelated model entries intact', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const actions = createActions(store);
    actions.setCharacterConfig('Mage', { speedMultiplier: 0.7 });
    actions.setCharacterConfig('Knight', { charRadius: 0.55 });
    expect(store.getState().characterConfigs).toEqual({
      Mage: { speedMultiplier: 0.7 },
      Knight: { charRadius: 0.55 },
    });
  });
});

describe('actions.setCharacterConfigs (bulk replace)', () => {
  it('replaces the entire characterConfigs map', () => {
    const store = createStore({ selfId: 'me', officeId: 'r' });
    const actions = createActions(store);
    actions.setCharacterConfig('Mage', { speedMultiplier: 0.7 });
    actions.setCharacterConfigs({ Knight: { charRadius: 0.55 } });
    expect(store.getState().characterConfigs).toEqual({
      Knight: { charRadius: 0.55 },
    });
  });
});
