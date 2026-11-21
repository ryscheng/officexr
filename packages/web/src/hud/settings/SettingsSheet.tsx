import { useEffect, useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowLeftRight, Bell, Box, Building2, ChevronRight, CircleHelp, Link2, LogOut, SlidersHorizontal, User, X, type LucideProps } from 'lucide-react';
import type { OfficeState, Store } from '@officexr/sdk';
import { useStoreSelector } from '@officexr/world/top-down';
import { SETTINGS_PAGES, type SettingsPageId } from '../../room/Settings';
import { InlineAlert } from '../ui/InlineAlert';
import { Panel, PanelTitle } from '../ui/Panel';
import { PortraitSheet } from '../ui/PortraitSheet';
import { sameFields } from '../sameFields';
import { useEscapeLayer } from '../useEscapeLayer';
import { PortraitFace } from '../PortraitFace';
import { useSelfPortrait } from '../playerPortrait';
import { PRESENCE_INDICATOR } from '../presenceColours';
import { SectionLabel } from './parts';

type Icon = ComponentType<LucideProps>;

const PAGES: Record<SettingsPageId, { title: string; hint: string; icon: Icon }> = {
  profile: { title: 'Profile', hint: 'Look and status', icon: User },
  controls: { title: 'Controls', hint: 'View, motion, appearance', icon: SlidersHorizontal },
  alerts: { title: 'Alerts', hint: 'Ping sound and notifications', icon: Bell },
  office: { title: 'Office', hint: 'Name, map, studio', icon: Building2 },
  help: { title: 'Help', hint: 'How to move, hints', icon: CircleHelp },
};

type Self = { name: string; focus: boolean; status: OfficeState['players'][string]['status'] };

const selectSelf = (s: OfficeState): Self => {
  const p = s.players[s.selfId];
  return { name: p?.name ?? '', focus: p?.focus ?? false, status: p?.status ?? 'available' };
};

const selfLabel = (self: Self) => (self.focus ? 'Focus' : PRESENCE_INDICATOR[self.status === 'away' ? 'away' : 'available'].label);

function Row({ icon: Icon, label, hint, tone, onClick }: { icon: Icon; label: string; hint?: string; tone?: 'danger'; onClick: () => void }) {
  return (
    <button
      type="button"
      data-settings-row
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3 rounded-xl bg-hud-surface px-4 py-1.5 text-left shadow-[0_0_0_0.5px_var(--color-hud-hairline)] hover:bg-hud-surface-hover focus-visible:outline-2 focus-visible:outline-hud-accent ${tone === 'danger' ? 'text-hud-rose-text' : ''}`}
    >
      <Icon aria-hidden className="size-[22px] shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-base leading-[22px] font-semibold">{label}</span>
        {hint && <span className="block text-sm leading-5 text-hud-text-2">{hint}</span>}
      </span>
      {tone !== 'danger' && <ChevronRight aria-hidden className="size-5 shrink-0 text-hud-text-2" />}
    </button>
  );
}

const Group = ({ children }: { children: ReactNode }) => <div className="flex flex-col gap-2">{children}</div>;

export type SettingsSheetProps = {
  store: Store;
  portrait: boolean;
  page: SettingsPageId | null;
  pages: Record<SettingsPageId, ReactNode>;
  canBuild: boolean;
  onPage: (page: SettingsPageId) => void;
  onBack: () => void;
  onClose: () => void;
  onInvite: () => void;
  onBuild: () => void;
  buildHint?: ReactNode;
  onSwitchOffice: () => void;
  onSignOut: () => Promise<void>;
};

function TopLevel({ store, canBuild, onPage, onInvite, onBuild, buildHint, onSwitchOffice, onSignOut }: Pick<SettingsSheetProps, 'store' | 'canBuild' | 'onPage' | 'onInvite' | 'onBuild' | 'buildHint' | 'onSwitchOffice' | 'onSignOut'>) {
  const self = useStoreSelector(store, selectSelf, sameFields);
  const portrait = useSelfPortrait();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const move = (e: KeyboardEvent<HTMLElement>) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!step) {
      return;
    }
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-settings-row]')];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    rows[(at + step + rows.length) % rows.length]?.focus();
    e.preventDefault();
  };
  return (
    <nav aria-label="Menu" onKeyDown={move} className="flex flex-col gap-2">
      <div className="flex items-center gap-3 px-2 py-1">
        <span
          aria-hidden
          className={`relative flex size-11 shrink-0 rounded-full bg-hud-avatar text-base font-semibold text-hud-text ring-2 ${self.focus ? 'ring-hud-accent' : self.status === 'away' ? 'ring-yellow-400' : 'ring-green-500'}`}
        >
          <PortraitFace src={portrait} initial={self.name.trim().charAt(0).toUpperCase() || 'Y'} />
        </span>
        <div className="min-w-0">
          <div className="text-base font-semibold">You</div>
          <div className="text-sm text-hud-text-2">{selfLabel(self)}</div>
        </div>
      </div>
      <SectionLabel>In this office</SectionLabel>
      <Group>
        <Row icon={Link2} label="Invite people" hint="Copy or share the link" onClick={onInvite} />
        {canBuild && <Row icon={Box} label="Build" hint="Place props" onClick={onBuild} />}
        {canBuild && buildHint}
        <Row icon={ArrowLeftRight} label="Switch office" onClick={onSwitchOffice} />
      </Group>
      <SectionLabel>Settings</SectionLabel>
      <Group>
        {SETTINGS_PAGES.map((id) => (
          <Row key={id} icon={PAGES[id].icon} label={PAGES[id].title} hint={PAGES[id].hint} onClick={() => onPage(id)} />
        ))}
      </Group>
      <SectionLabel>Account</SectionLabel>
      <Group>
        <Row
          icon={LogOut}
          label="Sign out"
          tone="danger"
          onClick={() => {
            setSignOutError(null);
            onSignOut().catch((err: Error) => setSignOutError(err.message));
          }}
        />
      </Group>
      {signOutError && <InlineAlert className="mx-1 text-sm">{signOutError}</InlineAlert>}
    </nav>
  );
}

export function SettingsSheet(props: SettingsSheetProps) {
  const { portrait, page, pages, onBack, onClose } = props;
  const headingId = useId();
  const body = useRef<HTMLDivElement>(null);
  useEscapeLayer(true, onBack);
  useEffect(() => {
    body.current?.scrollTo?.({ top: 0 });
  }, [page]);
  const title = page ? PAGES[page].title : 'Menu';
  const content = (
    <div ref={body} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-2 pb-1">
      {page ? <div key={page} className="flex flex-col gap-3">{pages[page]}</div> : <TopLevel {...props} />}
    </div>
  );
  if (portrait) {
    return (
      <PortraitSheet title={title} label="Menu" closeLabel="Close menu" onBack={page ? onBack : undefined} onClose={onClose} fill heightPct={90}>
        {content}
      </PortraitSheet>
    );
  }
  return createPortal(
    <Panel
      material="thick"
      role="dialog"
      aria-labelledby={headingId}
      data-hud-modal
      className="pointer-events-auto fixed top-(--hud-inset-top) right-(--hud-inset-right) bottom-(--hud-inset-bottom) z-40 flex w-[min(380px,50vw)] flex-col gap-2 p-2"
    >
      <div className={`flex shrink-0 items-center gap-2 ${page ? '' : 'pl-2'}`}>
        {page && (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-hud-text hover:bg-hud-hover focus-visible:outline-2 focus-visible:outline-hud-accent"
          >
            <ArrowLeft aria-hidden className="size-5" />
          </button>
        )}
        <PanelTitle id={headingId} className="flex-1 text-xl">
          {title}
        </PanelTitle>
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="flex min-h-12 min-w-12 items-center justify-center rounded-full bg-hud-inset text-hud-text-2 hover:bg-hud-hover hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      {content}
    </Panel>,
    document.body,
  );
}
