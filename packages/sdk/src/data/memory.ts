import type { InventoryItem, PlayerId } from '../game-state/types.ts';
import type { LootboxState, PersistenceAdapter, Profile } from './types.ts';

export class MemoryPersistenceAdapter implements PersistenceAdapter {
  private profiles = new Map<PlayerId, Profile>();
  private inventory = new Map<PlayerId, InventoryItem[]>();
  private lootbox = new Map<PlayerId, LootboxState>();

  async loadProfile(userId: PlayerId): Promise<Profile | null> {
    return this.profiles.get(userId) ?? null;
  }

  async saveProfile(profile: Profile): Promise<void> {
    this.profiles.set(profile.userId, { ...profile });
  }

  async loadInventory(userId: PlayerId): Promise<InventoryItem[]> {
    return [...(this.inventory.get(userId) ?? [])];
  }

  async saveInventoryItem(userId: PlayerId, item: InventoryItem): Promise<void> {
    const list = this.inventory.get(userId) ?? [];
    const idx = list.findIndex((i) => i.id === item.id);
    if (idx >= 0) {
      list[idx] = { ...item };
    } else {
      list.push({ ...item });
    }
    this.inventory.set(userId, list);
  }

  async removeInventoryItem(userId: PlayerId, itemId: string): Promise<void> {
    const list = this.inventory.get(userId);
    if (!list) return;
    this.inventory.set(
      userId,
      list.filter((i) => i.id !== itemId),
    );
  }

  async loadLootboxState(userId: PlayerId): Promise<LootboxState | null> {
    return this.lootbox.get(userId) ?? null;
  }

  async saveLootboxState(userId: PlayerId, state: LootboxState): Promise<void> {
    this.lootbox.set(userId, { ...state });
  }
}
