import { useEffect, useState, type ComponentType } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import type { OfficeState } from '@officexr/sdk';
import { CHARACTERS, pickCharacterForPlayer, type CharacterName } from '@officexr/world/characters';
import { CharacterPreviewCanvas } from '@officexr/world/renderer';
import type { apiFetch } from '../apiOrigin';
import { chooseCharacter } from './character';
import { useSettings } from './Settings';
import { SettingsActionButton } from './SettingsModal';

const selfCharacter = (s: OfficeState, selfId: string) =>
  pickCharacterForPlayer(selfId, s.players[selfId]?.avatar.model);

function useSelfCharacter({ store, selfId }: PersistentLocalState): CharacterName {
  const [character, setCharacter] = useState(() => selfCharacter(store.getState(), selfId));
  useEffect(() => store.subscribe((s) => selfCharacter(s, selfId), setCharacter), [store, selfId]);
  return character;
}

export function CharacterAction() {
  const { openPane } = useSettings();
  return <SettingsActionButton onClick={() => openPane('character')}>Character</SettingsActionButton>;
}

/** Reports each save's error, or `null` once a save succeeds. */
type SaveResult = (error: string | null) => void;

export function CharacterPane({
  local,
  onSaveResult,
  Preview = CharacterPreviewCanvas,
  fetchFn,
}: {
  local: PersistentLocalState;
  onSaveResult: SaveResult;
  Preview?: ComponentType<{ character: CharacterName }>;
  fetchFn?: typeof apiFetch;
}) {
  const character = useSelfCharacter(local);
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="h-64 flex-1 overflow-hidden rounded-hud-control bg-hud-inset">
        <Preview character={character} />
      </div>
      <select
        aria-label="Character"
        className="block w-full rounded-hud-control border-2 border-hud-edge bg-hud-inset p-2 font-bold text-hud-text"
        value={character}
        onChange={(e) =>
          chooseCharacter(local, e.target.value as CharacterName, fetchFn).then(
            () => onSaveResult(null),
            (err: Error) => onSaveResult(err.message),
          )
        }
      >
        {CHARACTERS.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </div>
  );
}
