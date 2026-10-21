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

export function CharacterPicker({ local, onError }: { local: PersistentLocalState; onError: (message: string) => void }) {
  const character = useSelfCharacter(local);
  const [open, setOpen] = useState(false);
  return (
    <div data-studio-panel className="absolute right-3 bottom-3 w-56 rounded bg-black/70 p-2 text-xs text-white">
      <button type="button" className="w-full text-left font-medium" aria-expanded={open} onClick={() => setOpen(!open)}>
        Character: {character}
      </button>
      {open && (
        <>
          <div className="my-2 h-56 overflow-hidden rounded">
            <CharacterPreviewCanvas character={character} />
          </div>
          <select
            aria-label="Character"
            className="w-full rounded bg-white px-1 py-0.5 text-black"
            value={character}
            onChange={(e) =>
              chooseCharacter(local, e.target.value as CharacterName).catch((err: Error) => onError(err.message))
            }
          >
            {CHARACTERS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}
