import type { PersistentLocalState } from '@officexr/core-refactor';
import { pickCharacterForPlayer } from '@officexr/world/characters';
import { apiFetch, paths } from '../apiOrigin';

/**
 * The login's stored character for the office, else (also when it can't be read) its deterministic default.
 * A stored catalog character is returned as-is: the server checked it on save, and the renderer resolves it
 * once the catalog loads.
 */
export async function loadCharacter(officeId: string, login: string, fetchFn: typeof apiFetch = apiFetch): Promise<string> {
  try {
    const res = await fetchFn(paths.character(officeId));
    const stored = res.ok ? ((await res.json()) as { characterId: string | null }).characterId : null;
    return stored || pickCharacterForPlayer(login);
  } catch (err) {
    console.warn('Could not load the saved character', err);
    return pickCharacterForPlayer(login);
  }
}

/** Shows `characterId` on the local player, which the sync engine broadcasts, and remembers it for the office. */
// ponytail: rapid picks can land out of order, and a failed save leaves the room showing an unsaved pick.
export async function chooseCharacter(local: PersistentLocalState, characterId: string, fetchFn: typeof apiFetch = apiFetch): Promise<void> {
  const self = local.store.getState().players[local.selfId];
  local.actions.upsertPlayer({ id: local.selfId, avatar: { ...self?.avatar, model: characterId } });
  const res = await fetchFn(paths.character(local.officeId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId }),
  });
  if (!res.ok) {
    throw new Error(`Could not save the character: HTTP ${res.status}`);
  }
}
