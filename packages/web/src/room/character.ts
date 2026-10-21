import type { PersistentLocalState } from '@officexr/core-refactor';
import { pickCharacterForPlayer, type CharacterName } from '@officexr/world/characters';

const characterUrl = (officeId: string) => `/api/offices/${encodeURIComponent(officeId)}/character`;

/** The login's stored character for the office, else (also when it can't be read) its deterministic default. */
export async function loadCharacter(officeId: string, login: string, fetchFn = fetch): Promise<CharacterName> {
  try {
    const res = await fetchFn(characterUrl(officeId));
    const stored = res.ok ? ((await res.json()) as { characterId: string | null }).characterId : null;
    return pickCharacterForPlayer(login, stored ?? undefined);
  } catch (err) {
    console.warn('Could not load the saved character', err);
    return pickCharacterForPlayer(login);
  }
}

/** Shows `characterId` on the local player, which the sync engine broadcasts, and remembers it for the office. */
// ponytail: rapid picks can land out of order, and a failed save leaves the room showing an unsaved pick.
export async function chooseCharacter(local: PersistentLocalState, characterId: CharacterName, fetchFn = fetch): Promise<void> {
  const self = local.store.getState().players[local.selfId];
  local.actions.upsertPlayer({ id: local.selfId, avatar: { ...self?.avatar, model: characterId } });
  const res = await fetchFn(characterUrl(local.officeId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId }),
  });
  if (!res.ok) {
    throw new Error(`Could not save the character: HTTP ${res.status}`);
  }
}
