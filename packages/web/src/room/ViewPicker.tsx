import { storeViewMode } from './viewMode';
import { storeOpenView, VIEW_GROUPS, type GameView, type OpenView } from './gameView';
import { SectionLabel } from '../hud/settings/parts';

/** Picking Map (2D) or leaving it stores the view mode and reloads, which rejoins the room in it; the 3D views switch at once. */
export function ViewPicker({
  value,
  onOpenView,
  reload = () => window.location.reload(),
}: {
  value: GameView;
  onOpenView: (view: OpenView) => void;
  reload?: () => void;
}) {
  const choose = (next: GameView) => {
    if (next === value) {
      return;
    }
    if (next === 'map') {
      storeViewMode('2d');
      reload();
      return;
    }
    storeOpenView(next);
    if (value === 'map') {
      storeViewMode('3d');
      reload();
      return;
    }
    onOpenView(next);
  };
  return (
    <div role="radiogroup" aria-label="View" className="flex flex-col gap-2">
      {VIEW_GROUPS.map((group) => (
        <div key={group.heading} className="flex flex-col gap-2">
          <SectionLabel>{group.heading}</SectionLabel>
          {group.options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => choose(option.value)}
                className={`flex min-h-14 w-full flex-col items-start justify-center rounded-xl px-4 py-2 text-left shadow-[0_0_0_0.5px_var(--color-hud-hairline)] focus-visible:outline-2 focus-visible:outline-hud-accent ${
                  selected ? 'bg-hud-accent-fill text-hud-on-accent' : 'bg-hud-surface hover:bg-hud-surface-hover'
                }`}
              >
                <span className="text-base font-medium">{option.label}</span>
                <span className={`text-sm ${selected ? '' : 'text-hud-text-2'}`}>{option.hint}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
