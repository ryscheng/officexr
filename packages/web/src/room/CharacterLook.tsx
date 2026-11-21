import { useEffect, useState, type ComponentType } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import type { OfficeState } from '@officexr/sdk';
import { baseCharacterOptions, catalogCharacterOptions, resolveCharacter, type CatalogCharacters, type CharacterOption } from '@officexr/world/characters';
import { useCatalogCharacters, useCharacterPortrait } from '@officexr/world/react';
import { CharacterPreviewCanvas } from '@officexr/world/renderer';
import type { apiFetch } from '../apiOrigin';
import { chooseCharacter } from './character';

const selfModel = (s: OfficeState, selfId: string) => s.players[selfId]?.avatar.model;

function useSelfCharacter({ store, selfId }: PersistentLocalState, catalog: CatalogCharacters): CharacterOption {
  const [model, setModel] = useState(() => selfModel(store.getState(), selfId));
  useEffect(() => store.subscribe((s) => selfModel(s, selfId), setModel), [store, selfId]);
  return resolveCharacter(selfId, model, catalog);
}

/** Reports each save's error, or `null` once a save succeeds. */
type SaveResult = (error: string | null) => void;

function LookOption({ option, selected, onSelect }: { option: CharacterOption; selected: boolean; onSelect: () => void }) {
  const portrait = useCharacterPortrait(option.url);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={option.label}
      title={option.label}
      onClick={onSelect}
      className={`flex min-h-12 min-w-12 flex-col items-center gap-1 rounded-hud-control p-1 text-center outline-offset-2 hover:bg-hud-hover focus-visible:outline-2 focus-visible:outline-hud-accent ${selected ? 'bg-hud-inset outline-[3px] outline-hud-accent' : ''}`}
    >
      <span aria-hidden className="flex size-14 items-center justify-center overflow-hidden rounded-xl bg-hud-avatar text-lg font-semibold text-hud-text">
        {portrait ? <img src={portrait} alt="" draggable={false} className="size-full object-cover" /> : option.label.charAt(0)}
      </span>
      <span aria-hidden className="line-clamp-2 text-xs leading-4 text-hud-text">
        {option.label}
      </span>
    </button>
  );
}

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
      <div role="radiogroup" aria-label="Look" className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2">
        {options.map((option) => (
          <LookOption
            key={option.id}
            option={option}
            selected={option.id === character.id}
            onSelect={() =>
              chooseCharacter(local, option.id, fetchFn).then(
                () => onSaveResult(null),
                (err: Error) => onSaveResult(err.message),
              )
            }
          />
        ))}
      </div>
    </>
  );
}
