import { useEffect, useState, type ComponentType } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import type { OfficeState } from '@officexr/sdk';
import { baseCharacterOptions, catalogCharacterOptions, resolveCharacter, type CatalogCharacters, type CharacterOption } from '@officexr/world/characters';
import { useCatalogCharacters } from '@officexr/world/react';
import { CharacterPreviewCanvas } from '@officexr/world/renderer';
import type { apiFetch } from '../apiOrigin';
import { chooseCharacter } from './character';

const selfModel = (s: OfficeState, selfId: string) => s.players[selfId]?.avatar.model;

function useSelfCharacter({ store, selfId }: PersistentLocalState, catalog: CatalogCharacters): CharacterOption {
  const [model, setModel] = useState(() => selfModel(store.getState(), selfId));
  useEffect(() => store.subscribe((s) => selfModel(s, selfId), setModel), [store, selfId]);
  return resolveCharacter(selfId, model, catalog);
}

const hue = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** Reports each save's error, or `null` once a save succeeds. */
type SaveResult = (error: string | null) => void;

export function CharacterLook({
  local,
  onSaveResult,
  Preview = CharacterPreviewCanvas,
  fetchFn,
}: {
  local: PersistentLocalState;
  onSaveResult: SaveResult;
  Preview?: ComponentType<{ url: string }>;
  fetchFn?: typeof apiFetch;
}) {
  const catalog = useCatalogCharacters();
  const character = useSelfCharacter(local, catalog);
  const options = [...baseCharacterOptions(), ...catalogCharacterOptions(catalog)];
  return (
    <>
      <div className="h-[140px] shrink-0 overflow-hidden rounded-hud-control bg-hud-inset">
        <Preview url={character.url} />
      </div>
      <h3 className="px-1 text-sm font-semibold text-hud-text-2">Look</h3>
      <div role="radiogroup" aria-label="Look" className="flex flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.id === character.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.label}
              title={option.label}
              style={{ backgroundColor: `hsl(${hue(option.id)} 38% 46%)` }}
              onClick={() =>
                chooseCharacter(local, option.id, fetchFn).then(
                  () => onSaveResult(null),
                  (err: Error) => onSaveResult(err.message),
                )
              }
              className={`flex size-14 items-center justify-center rounded-full text-lg font-semibold text-white outline-offset-2 focus-visible:outline-2 focus-visible:outline-hud-accent ${selected ? 'outline-[3px] outline-hud-accent' : ''}`}
            >
              <span aria-hidden>{option.label.charAt(0)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
