import { Keycap } from '../hud/ui/Keycap';
import { SHORTCUT_GROUPS, SHORTCUTS } from './shortcuts';

export function KeybindsTab() {
  return (
    <div className="space-y-4">
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group}>
          <h3 className="mb-1.5 px-1 text-sm font-semibold text-hud-text-2">{group}</h3>
          <dl className="divide-y divide-hud-separator overflow-hidden rounded-xl bg-hud-surface shadow-[0_0_0_0.5px_var(--color-hud-hairline)]">
            {SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <div key={s.keys + s.description} className="flex items-center justify-between gap-4 px-4 py-2">
                <dt>{s.description}</dt>
                <dd>
                  <Keycap>{s.keys}</Keycap>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
