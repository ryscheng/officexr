import { Fragment, useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowLeft, Settings as SettingsIcon, X } from 'lucide-react';
import { IconButton } from '../hud/IconButton';
import { Keycap } from '../hud/ui/Keycap';
import { Modal } from '../hud/ui/Modal';
import { PanelTitle } from '../hud/ui/Panel';
import { Tab, TabContent, TabList, Tabs } from '../hud/ui/Tabs';
import { useSettings, type SettingsAction, type SettingsPane, type SettingsTab } from './Settings';

export function SettingsButton() {
  const { open } = useSettings();
  return (
    <div data-studio-panel className="pointer-events-none flex">
      <IconButton icon={SettingsIcon} label="Settings" tone="accent" onClick={() => open()} />
    </div>
  );
}

/** A row in the Settings sidebar's action list (Back to office, Pop out, Character, …). */
export function SettingsActionButton({
  onClick,
  primary = false,
  type = 'button',
  children,
}: {
  onClick?: () => void;
  primary?: boolean;
  type?: 'button' | 'submit' | 'reset';
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`w-full rounded-lg px-3 py-1.5 text-left font-hud-body text-[13px] transition-colors disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-hud-accent pointer-coarse:min-h-11 ${
        primary
          ? 'bg-hud-accent font-semibold text-hud-on-accent shadow-[0_1px_3px_var(--color-hud-accent-shadow)] hover:bg-hud-accent-edge'
          : 'font-medium text-hud-text hover:bg-hud-hover'
      }`}
    >
      {children}
    </button>
  );
}

/** An action that closes Settings before running `onSelect`. */
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

/** One setting as a rounded, grouped-list row: label on the left, control on the right. */
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/70 px-4 py-2.5 shadow-[0_0_0_0.5px_rgb(15_23_42/0.08)]">
      <span className="text-[13px] font-medium">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** Tabs sharing an id are one tab, so a view can add rows to a shared tab. */
function mergeTabs(tabs: readonly SettingsTab[]): SettingsTab[] {
  const byId = new Map<string, SettingsTab>();
  for (const tab of tabs) {
    const prev = byId.get(tab.id);
    byId.set(
      tab.id,
      prev
        ? {
            ...prev,
            content: (
              <>
                {prev.content}
                {tab.content}
              </>
            ),
          }
        : tab,
    );
  }
  return [...byId.values()];
}

interface SettingsModalProps {
  title?: string;
  tabs: readonly SettingsTab[];
  panes?: readonly SettingsPane[];
  actions: readonly SettingsAction[];
}

export function SettingsModal(props: SettingsModalProps) {
  return useSettings().isOpen ? <OpenSettingsModal {...props} /> : null;
}

/** Focus moves into the pane when it opens and back to the dialog when it closes, so Escape keeps reaching the modal. */
function PaneView({ pane, onBack }: { pane: SettingsPane; onBack: () => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const dialog = ref.current?.closest<HTMLElement>('[role="dialog"]');
    ref.current?.focus();
    return () => dialog?.focus();
  }, []);
  return (
    <section ref={ref} tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 outline-none">
      <div className="flex items-center gap-2">
        <IconButton icon={ArrowLeft} label="Back" size="row" onClick={onBack} />
        <span className="text-xs font-medium text-hud-text-2">Back to settings</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col text-sm">{pane.content}</div>
    </section>
  );
}

function OpenSettingsModal({ title, tabs, panes = [], actions }: SettingsModalProps) {
  const { tab, pane, open, back, close } = useSettings();
  const titleId = useId();
  const subtitleId = useId();
  const merged = mergeTabs(tabs);
  const openPane = panes.find((p) => p.id === pane);
  const current = merged.find((t) => t.id === tab) ?? merged[0];
  return (
    <Modal
      data-studio-panel
      labelledBy={`${titleId} ${subtitleId}`}
      onEscape={openPane ? back : close}
      className="z-40 bg-[rgb(15_23_42/0.16)]"
      panelClassName="flex h-[min(620px,100%)] w-full max-w-4xl flex-col overflow-hidden sm:flex-row"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* macOS System Settings: a frosted source list, then the chosen section on a lighter pane. */}
      <Tabs value={current?.id} onValueChange={open} orientation="vertical" className="contents">
        <aside className="flex shrink-0 flex-col gap-4 border-hud-separator bg-black/[0.025] p-3 sm:w-60 sm:border-r">
          <div className="px-2 pt-1">
            <PanelTitle id={titleId} className="text-[15px]">
              Settings
            </PanelTitle>
            <p id={subtitleId} className="truncate text-xs text-hud-text-2">
              {title}
            </p>
          </div>
          {!openPane && (
            <TabList variant="sidebar" aria-label="Settings sections">
              {merged.map((t) => (
                <Tab key={t.id} value={t.id} variant="sidebar">
                  {t.label}
                </Tab>
              ))}
            </TabList>
          )}
          <nav aria-label="Settings actions" className="mt-auto flex flex-col gap-0.5 border-t border-hud-separator pt-3">
            {actions.map((action) => (
              <Fragment key={action.id}>{action.render(close)}</Fragment>
            ))}
            <div className="pt-2">
              <SettingsActionButton primary onClick={close}>
                Back to office
              </SettingsActionButton>
            </div>
          </nav>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
            <h3 className="font-hud-title text-xl font-semibold tracking-tight">{openPane ? openPane.label : current?.label}</h3>
            <div className="flex items-center gap-2 text-xs text-hud-text-2">
              <Keycap>Esc</Keycap>
              <IconButton icon={X} label="Close" size="row" onClick={close} />
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6">
            {openPane ? (
              <PaneView pane={openPane} onBack={back} />
            ) : (
              merged.map((t) => (
                <TabContent key={t.id} value={t.id} className="space-y-2 text-[13px] outline-none">
                  {t.content}
                </TabContent>
              ))
            )}
          </div>
        </div>
      </Tabs>
    </Modal>
  );
}
