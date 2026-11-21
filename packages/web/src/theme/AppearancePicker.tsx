import { useSyncExternalStore } from 'react';
import { appearanceController, type Appearance, type AppearanceController } from './appearance';

const OPTIONS: readonly { value: Appearance; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
];

/** A tiny window in each theme, like the previews in macOS's Appearance setting. */
function Preview({ value }: { value: Appearance }) {
  const window = (dark: boolean) => (
    <span className={`flex h-full flex-1 flex-col gap-1 p-1.5 ${dark ? 'bg-[#1c1c1e]' : 'bg-[#f2f2f7]'}`}>
      <span className={`h-1.5 w-8 rounded-full ${dark ? 'bg-[#48484a]' : 'bg-[#d1d1d6]'}`} />
      <span className={`flex-1 rounded-[5px] ${dark ? 'bg-[#2c2c2e]' : 'bg-white'} shadow-[0_0_0_0.5px_rgb(0_0_0/0.1)]`} />
      <span className="h-1.5 w-5 rounded-full bg-[#0a84ff]" />
    </span>
  );
  return (
    <span aria-hidden className="flex h-14 w-[84px] overflow-hidden rounded-lg shadow-[0_0_0_0.5px_rgb(0_0_0/0.15),0_1px_3px_rgb(0_0_0/0.12)]">
      {value === 'auto' ? (
        <>
          {window(false)}
          {window(true)}
        </>
      ) : (
        window(value === 'dark')
      )}
    </span>
  );
}

/** Light, Dark or Auto (follow the system), as preview cards; applies and remembers the choice at once. */
export function AppearancePicker({ controller = appearanceController() }: { controller?: AppearanceController }) {
  const value = useSyncExternalStore(controller.subscribe, controller.get);
  return (
    <div role="radiogroup" aria-label="Appearance" className="flex flex-wrap gap-2">
      {OPTIONS.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => controller.set(option.value)}
            className="group flex flex-col items-center gap-1.5 rounded-xl outline-none"
          >
            <span className={`rounded-[11px] p-0.5 ring-2 transition-shadow ${checked ? 'ring-hud-accent' : 'ring-transparent group-hover:ring-hud-hairline'} group-focus-visible:ring-hud-accent`}>
              <Preview value={option.value} />
            </span>
            <span className={`text-xs ${checked ? 'font-semibold text-hud-text' : 'text-hud-text-2'}`}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
