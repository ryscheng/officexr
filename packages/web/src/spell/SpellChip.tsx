import { SPELL_IDS, SPELLS, type Actions, type Store } from '@officexr/sdk';
import { focusWorld, useStoreSelector } from '@officexr/world/top-down';
import { Keycap } from '../hud/ui/Keycap';
import { Panel } from '../hud/ui/Panel';

/** While the self player holds the wand: the spell it casts next, with a button and number key for each spell. */
export function SpellChip({ store, actions, selfId }: { store: Store; actions: Actions; selfId: string }) {
  const holding = useStoreSelector(store, (s) => s.players[selfId]?.held === 'wand');
  const selected = useStoreSelector(store, (s) => s.selectedSpell);
  if (!holding) {
    return null;
  }
  return (
    <Panel className="pointer-events-auto flex items-center gap-1 p-1.5" role="group" aria-label="Wand spell">
      {SPELL_IDS.map((id, i) => (
        <button
          key={id}
          type="button"
          aria-pressed={selected === id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            actions.setSelectedSpell(id);
            focusWorld();
          }}
          className={`flex items-center gap-1.5 rounded-hud-control px-2 py-1 text-xs font-semibold transition-colors ${
            selected === id ? 'bg-hud-accent text-hud-on-accent' : 'text-hud-text-2 hover:bg-hud-hover hover:text-hud-text'
          }`}
        >
          <Keycap>{i + 1}</Keycap>
          {SPELLS[id].label}
        </button>
      ))}
    </Panel>
  );
}
