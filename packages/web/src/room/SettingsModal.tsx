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
    <div data-studio-panel className="pointer-events-none absolute top-[12px] right-[52px] z-20">
      <IconButton icon={SettingsIcon} label="Settings" tone="accent" onClick={() => open()} />
    </div>
  );
}

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
      className={`w-full rounded-hud-control border-2 px-4 py-3 text-left disabled:pointer-events-none disabled:opacity-50 font-hud-title text-sm font-normal tracking-widest uppercase shadow-hud-control ${
        primary
          ? 'border-hud-text bg-hud-text text-hud-on-accent'
          : 'border-hud-edge bg-hud-inset text-hud-text hover:bg-hud-edge'
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

export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="font-bold">{label}</span>
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
        <IconButton icon={ArrowLeft} label="Back" onClick={onBack} />
        <PanelTitle className="text-lg">{pane.label}</PanelTitle>
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
  return (
    <Modal
      data-studio-panel
      labelledBy={`${titleId} ${subtitleId}`}
      onEscape={openPane ? back : close}
      className="z-40 bg-black/60"
      panelClassName={`flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-auto p-5 ${openPane ? 'h-full' : ''}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <PanelTitle id={titleId} className="text-2xl">
            Settings
          </PanelTitle>
          <p id={subtitleId} className="text-sm text-hud-text-2">
            {title}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-hud-text-2">
          <Keycap>Esc</Keycap>
          <IconButton icon={X} label="Close" onClick={close} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 sm:flex-row">
        <nav className="flex shrink-0 flex-col gap-2 sm:w-56">
          <SettingsActionButton primary onClick={close}>
            Back to office
          </SettingsActionButton>
          {actions.map((action) => (
            <Fragment key={action.id}>{action.render(close)}</Fragment>
          ))}
        </nav>
        {openPane ? (
          <PaneView pane={openPane} onBack={back} />
        ) : (
          <Tabs value={tab ?? merged[0]?.id} onValueChange={open} className="min-w-0 flex-1">
            <TabList>
              {merged.map((t) => (
                <Tab key={t.id} value={t.id}>
                  {t.label}
                </Tab>
              ))}
            </TabList>
            {merged.map((t) => (
              <TabContent key={t.id} value={t.id} className="pt-3 text-sm outline-none">
                {t.content}
              </TabContent>
            ))}
          </Tabs>
        )}
      </div>
    </Modal>
  );
}
