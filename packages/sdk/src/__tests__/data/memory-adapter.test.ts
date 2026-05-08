import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryPersistenceAdapter } from '../../data/memory.ts';
import type { PersistenceAdapter } from '../../data/types.ts';

describe('MemoryPersistenceAdapter', () => {
  let adapter: PersistenceAdapter;
  beforeEach(() => {
    adapter = new MemoryPersistenceAdapter();
  });

  it('loadProfile returns null for unknown user', async () => {
    expect(await adapter.loadProfile('nope')).toBeNull();
  });

  it('saveProfile + loadProfile roundtrips', async () => {
    await adapter.saveProfile({ userId: 'u1', name: 'Alice', avatar: { model: 'gnome' } });
    const p = await adapter.loadProfile('u1');
    expect(p?.name).toBe('Alice');
    expect(p?.avatar.model).toBe('gnome');
  });

  it('inventory CRUD per user', async () => {
    expect(await adapter.loadInventory('u1')).toEqual([]);
    await adapter.saveInventoryItem('u1', { id: 'a', itemId: 'sword', qty: 1, acquiredAt: 100 });
    await adapter.saveInventoryItem('u1', { id: 'b', itemId: 'shield', qty: 1, acquiredAt: 200 });
    const inv = await adapter.loadInventory('u1');
    expect(inv).toHaveLength(2);
    await adapter.removeInventoryItem('u1', 'a');
    expect((await adapter.loadInventory('u1')).map((i) => i.id)).toEqual(['b']);
  });

  it('isolates inventory across users', async () => {
    await adapter.saveInventoryItem('u1', { id: 'a', itemId: 'sword', qty: 1, acquiredAt: 0 });
    await adapter.saveInventoryItem('u2', { id: 'a', itemId: 'shield', qty: 1, acquiredAt: 0 });
    expect((await adapter.loadInventory('u1'))[0].itemId).toBe('sword');
    expect((await adapter.loadInventory('u2'))[0].itemId).toBe('shield');
  });

  it('lootbox state defaults to null and persists', async () => {
    expect(await adapter.loadLootboxState('u1')).toBeNull();
    await adapter.saveLootboxState('u1', { lastOpenedAt: 12345 });
    expect((await adapter.loadLootboxState('u1'))?.lastOpenedAt).toBe(12345);
  });

  it('upserting an inventory item with an existing id replaces it', async () => {
    await adapter.saveInventoryItem('u1', { id: 'a', itemId: 'sword', qty: 1, acquiredAt: 0 });
    await adapter.saveInventoryItem('u1', { id: 'a', itemId: 'sword', qty: 5, acquiredAt: 1 });
    const inv = await adapter.loadInventory('u1');
    expect(inv).toHaveLength(1);
    expect(inv[0].qty).toBe(5);
  });
});
