import { useEffect, useState, type ReactNode } from 'react';
import type { Store } from '@officexr/sdk';
import { focusWorld, usePlayControls, useStoreSelector } from '@officexr/world/top-down';
import { Button } from '../hud/ui/Button';
import { Panel } from '../hud/ui/Panel';
import { assertNever } from '../ping/assertNever';
import { sameDeskBanner, selectDeskBanner, type DeskBanner } from './deskBanner';
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

/** A HUD button that hands focus straight back to the world, so movement keys keep working after a click. */
function HudButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Button
      size="sm"
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClick();
        focusWorld();
      }}
      className="pointer-events-auto"
    >
      {children}
    </Button>
  );
}

/** Desk banner: claim at a free desk, unclaim only at your own, and return-to-desk away from it. Lives in the HUD's top-centre zone. */
export function DeskHud({ store, requestDeskClaim }: { store: Store; requestDeskClaim: RequestDeskClaim }) {
  const banner = useStoreSelector(store, selectDeskBanner, sameDeskBanner);
  const { hasDesk, returnToDesk } = usePlayControls();
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
    <div data-studio-panel className="pointer-events-none flex max-w-full flex-col items-center gap-2">
      <div className="flex max-w-full flex-wrap items-center justify-center gap-2">
        {text && <Panel className="max-w-56 truncate px-3 py-1.5 text-xs font-bold">{text}</Panel>}
        {banner?.type === 'claimable' && (
          <HudButton disabled={pending} onClick={() => request(banner.deskId)}>
            {banner.ownsOther ? 'Move desk here' : 'Claim desk'}
          </HudButton>
        )}
        {banner?.type === 'mine' && (
          <HudButton disabled={pending} onClick={() => request(null)}>
            Unclaim desk
          </HudButton>
        )}
        {hasDesk && banner?.type !== 'mine' && <HudButton onClick={returnToDesk}>Return to desk</HudButton>}
      </div>
      {error !== null && (
        <div role="status" className="rounded-hud-control border border-hud-rose-text/30 bg-hud-rose px-3 py-1.5 font-hud-body text-xs font-bold text-hud-rose-text shadow-hud-control">
          {errorMessage(error)}
        </div>
      )}
    </div>
  );
}
