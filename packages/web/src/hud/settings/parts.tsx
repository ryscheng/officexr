import type { ReactNode } from 'react';
import type { SettingsAction } from '../../room/Settings';

export function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-hud-surface px-4 py-2 shadow-[0_0_0_0.5px_var(--color-hud-hairline)]">
      <div className="min-w-0">
        <div className="text-base font-medium">{label}</div>
        {hint && <div className="text-sm text-hud-text-2">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function SettingsActionButton({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center rounded-xl bg-hud-surface px-4 text-left text-base font-medium shadow-[0_0_0_0.5px_var(--color-hud-hairline)] hover:bg-hud-surface-hover focus-visible:outline-2 focus-visible:outline-hud-accent"
    >
      {children}
    </button>
  );
}

export const closingAction = (id: string, label: string, onSelect: () => void): SettingsAction => ({
  id,
  render: (close) => (
    <SettingsActionButton
      onClick={() => {
        close();
        onSelect();
      }}
    >
      {label}
    </SettingsActionButton>
  ),
});

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="px-1 pt-2 text-xs font-semibold tracking-wide text-hud-text-2 uppercase">{children}</h3>;
}
