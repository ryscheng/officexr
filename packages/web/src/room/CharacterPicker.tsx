import { useEffect, useState } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import type { OfficeState } from '@officexr/sdk';
import { CHARACTERS, pickCharacterForPlayer, type CharacterName } from '@officexr/world/characters';
import { CharacterPreviewCanvas } from '@officexr/world/renderer';
import { chooseCharacter } from './character';

const selfCharacter = (s: OfficeState, selfId: string) => pickCharacterForPlayer(selfId, s.players[selfId]?.avatar.model);

function useSelfCharacter({ store, selfId }: PersistentLocalState): CharacterName {
  const [character, setCharacter] = useState(() => selfCharacter(store.getState(), selfId));
  useEffect(() => store.subscribe((s) => selfCharacter(s, selfId), setCharacter), [store, selfId]);
  return character;
}

/** Reports each save's error, or `null` once a save succeeds. */
type SaveResult = (error: string | null) => void;

export function CharacterPicker({ local, onSaveResult }: { local: PersistentLocalState; onSaveResult: SaveResult }) {
  const character = useSelfCharacter(local);
  const [open, setOpen] = useState(false);
  return (
    <div data-studio-panel className="pointer-events-auto w-56 rounded bg-black/70 p-2 text-xs text-white">
      {open && (
        <>
          <div className="mb-2 h-40 overflow-hidden rounded">
            <CharacterPreviewCanvas character={character} />
          </div>
          <select
            aria-label="Character"
            className="mb-2 w-full rounded bg-white px-1 py-0.5 text-black"
            value={character}
            onChange={(e) =>
              chooseCharacter(local, e.target.value as CharacterName).then(
                () => onSaveResult(null),
                (err: Error) => onSaveResult(err.message),
              )
            }
          >
            {CHARACTERS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </>
      )}
      <button type="button" className="w-full text-left font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
        Character: {character}
      </button>
    </div>
  );
}
