import { useEffect, useState, type ComponentType } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import type { OfficeState } from '@officexr/sdk';
import { CHARACTERS, pickCharacterForPlayer, type CharacterName } from '@officexr/world/characters';
import { focusWorld } from '@officexr/world/react';
import { CharacterPreviewCanvas } from '@officexr/world/renderer';
import { Dialog } from '../Dialog';
import { chooseCharacter } from './character';

const selfCharacter = (s: OfficeState, selfId: string) => pickCharacterForPlayer(selfId, s.players[selfId]?.avatar.model);

function useSelfCharacter({ store, selfId }: PersistentLocalState): CharacterName {
  const [character, setCharacter] = useState(() => selfCharacter(store.getState(), selfId));
  useEffect(() => store.subscribe((s) => selfCharacter(s, selfId), setCharacter), [store, selfId]);
  return character;
}

/** Reports each save's error, or `null` once a save succeeds. */
type SaveResult = (error: string | null) => void;

export function CharacterDialog({
  local,
  onSaveResult,
  onClose,
  Preview = CharacterPreviewCanvas,
  fetchFn,
}: {
  local: PersistentLocalState;
  onSaveResult: SaveResult;
  onClose: () => void;
  Preview?: ComponentType<{ character: CharacterName }>;
  fetchFn?: typeof fetch;
}) {
  const character = useSelfCharacter(local);
  return (
    <Dialog
      title="Character"
      onClose={() => {
        onClose();
        // The dialog's focus-in released keyboard control from the world.
        focusWorld();
      }}
    >
      <div className="mb-3 h-40 overflow-hidden rounded">
        <Preview character={character} />
      </div>
      <select
        aria-label="Character"
        className="block w-full rounded border p-2"
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
    </Dialog>
  );
}
