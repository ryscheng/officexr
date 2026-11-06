import { Keycap } from '../hud/ui/Keycap';
import { SHORTCUT_GROUPS, SHORTCUTS } from './shortcuts';

export function KeybindsTab() {
  return (
    <div className="space-y-4">
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group}>
          <h3 className="mb-1 font-hud-title font-normal tracking-widest text-hud-text-2 uppercase">{group}</h3>
          <dl className="space-y-1">
            {SHORTCUTS.filter((s) => s.group === group).map((s) => (
              <div key={s.keys + s.description} className="flex items-center justify-between gap-4">
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
