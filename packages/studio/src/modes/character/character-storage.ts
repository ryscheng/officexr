import type { CharacterConfig, CharacterConfigs } from '@officexr/sdk';

const STORAGE_KEY = 'officexr:studio:characterConfigs';

/**
 * Persists per-model tuning between sessions. v1 uses localStorage —
 * no Vite middleware yet because the editor doesn't broadcast and
 * the file-on-disk story can wait. Debug mode loads this on startup
 * and pushes it into the multiplayer SDK store via
 * `actions.setCharacterConfigs(...)`, which then broadcasts via
 * the existing `world:characters` NetEvent.
 */
export class CharacterStorage {
  load(): CharacterConfigs {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed as CharacterConfigs;
    } catch {
      return {};
    }
  }

  save(configs: CharacterConfigs): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(configs));
    } catch {
      // ignore — quota exceeded or storage blocked.
    }
  }

  patch(modelId: string, patch: Partial<CharacterConfig>): CharacterConfigs {
    const current = this.load();
    const merged: CharacterConfigs = {
      ...current,
      [modelId]: { ...current[modelId], ...patch },
    };
    this.save(merged);
    return merged;
  }
}
