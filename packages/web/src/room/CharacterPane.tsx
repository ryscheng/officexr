import { useEffect, useState, type ComponentType } from 'react';
import type { PersistentLocalState } from '@officexr/core-refactor';
import type { OfficeState } from '@officexr/sdk';
import { baseCharacterOptions, catalogCharacterOptions, resolveCharacter, type CatalogCharacters, type CharacterOption } from '@officexr/world/characters';
import { useCatalogCharacters } from '@officexr/world/react';
import { CharacterPreviewCanvas } from '@officexr/world/renderer';
import type { apiFetch } from '../apiOrigin';
import { FIELD } from '../hud/ui/fieldStyles';
import { chooseCharacter } from './character';
import { useSettings } from './Settings';
import { SettingsActionButton } from './SettingsModal';

const selfModel = (s: OfficeState, selfId: string) => s.players[selfId]?.avatar.model;

function useSelfCharacter({ store, selfId }: PersistentLocalState, catalog: CatalogCharacters): CharacterOption {
  const [model, setModel] = useState(() => selfModel(store.getState(), selfId));
  useEffect(() => store.subscribe((s) => selfModel(s, selfId), setModel), [store, selfId]);
  return resolveCharacter(selfId, model, catalog);
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
  Preview?: ComponentType<{ url: string }>;
  fetchFn?: typeof apiFetch;
}) {
  const catalog = useCatalogCharacters();
  const character = useSelfCharacter(local, catalog);
  const uploaded = catalogCharacterOptions(catalog);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="min-h-40 flex-1 overflow-hidden rounded-hud-control bg-hud-inset">
        <Preview url={character.url} />
      </div>
      <select
        aria-label="Character"
        className={`${FIELD} font-bold`}
        value={character.id}
        onChange={(e) =>
          chooseCharacter(local, e.target.value, fetchFn).then(
            () => onSaveResult(null),
            (err: Error) => onSaveResult(err.message),
          )
        }
      >
        <CharacterOptions options={baseCharacterOptions()} />
        {uploaded.length > 0 && (
          <optgroup label="More characters">
            <CharacterOptions options={uploaded} />
          </optgroup>
        )}
      </select>
    </div>
  );
}

function CharacterOptions({ options }: { options: readonly CharacterOption[] }) {
  return options.map((c) => (
    <option key={c.id} value={c.id}>
      {c.label}
    </option>
  ));
}
