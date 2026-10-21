import type { PersistentLocalState } from '@officexr/core-refactor';
import { pickCharacterForPlayer, type CharacterName } from '@officexr/world/characters';

const characterUrl = (officeId: string) => `/api/offices/${encodeURIComponent(officeId)}/character`;

/** The login's stored character for the office, else its deterministic default. */
export async function loadCharacter(officeId: string, login: string, fetchFn = fetch): Promise<CharacterName> {
  const res = await fetchFn(characterUrl(officeId)).catch(() => null);
  const stored = res?.ok ? ((await res.json()) as { characterId: string | null }).characterId : null;
  return pickCharacterForPlayer(login, stored ?? undefined);
}

/** Shows `characterId` on the local player, which the sync engine broadcasts, and remembers it for the office. */
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
