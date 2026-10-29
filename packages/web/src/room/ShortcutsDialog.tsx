import { Dialog } from '../Dialog';
import { closeToWorld } from './closeToWorld';
import { SHORTCUT_GROUPS, SHORTCUTS } from './shortcuts';

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={closeToWorld(onClose)}>
      <div className="space-y-3">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group}>
            <h3 className="mb-1 font-medium">{group}</h3>
            <dl className="space-y-1">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.keys + s.description} className="flex justify-between gap-4">
                  <dt>{s.description}</dt>
                  <dd>
                    <kbd className="rounded border bg-gray-100 px-1.5 py-0.5 text-xs">{s.keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
