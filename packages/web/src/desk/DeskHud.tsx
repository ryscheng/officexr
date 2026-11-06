import { useEffect, useState, type ReactNode } from 'react';
import type { Store } from '@officexr/sdk';
import { focusWorld, usePlayControls, useStoreSelector } from '@officexr/world/top-down';
import { Panel } from '../hud/ui/Panel';
import { assertNever } from '../ping/assertNever';
import { sameDeskBanner, selectDeskBanner, selectOwnsDesk, type DeskBanner } from './deskBanner';
import type { RequestDeskClaim } from './requestDeskClaim';
import { useReturnToDeskHotkey } from './useReturnToDeskHotkey';

const TOAST_MS = 3000;

type ClaimError = Extract<Awaited<ReturnType<RequestDeskClaim>>, { ok: false }>['error'];

const errorMessage = (error: ClaimError) =>
  error === 'taken'
    ? 'Desk already taken'
    : error === 'unknown-desk'
      ? 'This desk no longer exists'
      : error === 'unavailable'
        ? "Couldn't reach the server"
        : assertNever(error);

const bannerText = (banner: DeskBanner) =>
  banner.type === 'claimable'
    ? null
    : banner.type === 'mine'
      ? 'Your desk'
      : banner.type === 'taken'
        ? `${banner.owner}'s desk`
        : assertNever(banner);

function HudButton({ onClick, disabled, className = '', children }: { onClick: () => void; disabled?: boolean; className?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClick();
        focusWorld();
      }}
      className={`pointer-events-auto rounded-hud-control bg-hud-panel px-3 py-1.5 font-hud-body text-xs font-bold text-hud-text hover:bg-hud-edge focus-visible:outline-2 focus-visible:outline-hud-accent disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-11 ${className}`}
    >
      {children}
    </button>
  );
}

/** Desk banner with claim, unclaim and return-to-desk controls, plus a Sit button on touch screens. */
export function DeskHud({ store, requestDeskClaim }: { store: Store; requestDeskClaim: RequestDeskClaim }) {
  const banner = useStoreSelector(store, selectDeskBanner, sameDeskBanner);
  const ownsDesk = useStoreSelector(store, selectOwnsDesk);
  const { hasDesk, nearbySeatId, sit, returnToDesk } = usePlayControls();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ClaimError | null>(null);
  useReturnToDeskHotkey(returnToDesk);
  useEffect(() => {
    if (error === null) {
      return;
    }
    const id = setTimeout(() => setError(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [error]);

  const request = (deskId: string | null) => {
    setPending(true);
    setError(null);
    void requestDeskClaim(deskId).then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error);
      }
    });
  };

  const text = banner && bannerText(banner);
  return (
    <div data-studio-panel className="pointer-events-none absolute top-16 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        {text && <Panel className="px-3 py-1.5 text-xs font-bold">{text}</Panel>}
        {banner?.type === 'claimable' && (
          <HudButton disabled={pending} onClick={() => request(banner.deskId)}>
            {banner.ownsOther ? 'Move desk here' : 'Claim desk'}
          </HudButton>
        )}
        {ownsDesk && (
          <HudButton disabled={pending} onClick={() => request(null)}>
            Unclaim desk
          </HudButton>
        )}
        {hasDesk && <HudButton onClick={returnToDesk}>Return to desk</HudButton>}
        {nearbySeatId !== null && (
          <HudButton onClick={() => sit()} className="hidden pointer-coarse:block">
            Sit
          </HudButton>
        )}
      </div>
      {error !== null && (
        <div role="status" className="rounded-hud-control bg-hud-rose px-3 py-1.5 font-hud-body text-xs font-bold text-hud-rose-text">
          {errorMessage(error)}
        </div>
      )}
    </div>
  );
}
