import type { AvatarData, InventoryItem, PlayerId } from '../game-state/types.ts';

export type Profile = {
  userId: PlayerId;
  name: string;
  avatar: AvatarData;
};

export type LootboxState = {
  lastOpenedAt: number;
};

// Generic persistence boundary. The real Supabase implementation is deferred;
// MemoryPersistenceAdapter provides an in-memory drop-in for tests and
// development.
export interface PersistenceAdapter {
  loadProfile(userId: PlayerId): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<void>;

  loadInventory(userId: PlayerId): Promise<InventoryItem[]>;
  saveInventoryItem(userId: PlayerId, item: InventoryItem): Promise<void>;
  removeInventoryItem(userId: PlayerId, itemId: string): Promise<void>;

  loadLootboxState(userId: PlayerId): Promise<LootboxState | null>;
  saveLootboxState(userId: PlayerId, state: LootboxState): Promise<void>;
}
