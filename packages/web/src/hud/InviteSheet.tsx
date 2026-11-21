import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Share2, X } from 'lucide-react';
import { Button } from './ui/Button';
import { FIELD } from './ui/fieldStyles';
import { InlineAlert } from './ui/InlineAlert';
import { Panel, PanelTitle } from './ui/Panel';
import { PortraitSheet } from './ui/PortraitSheet';
import { canShare, copyLink } from './copyLink';
import { useEscapeLayer } from './useEscapeLayer';

const COPIED_MS = 2000;

function InviteBody({ url, officeName, created, coarse, portrait, onClose }: { url: string; officeName: string; created: boolean; coarse: boolean; portrait: boolean; onClose: () => void }) {
  const field = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const share = canShare();

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const ok = await copyLink(url, field.current);
    setFailed(!ok);
    setCopied(ok);
  };
  const send = async () => {
    try {
      await navigator.share({ title: officeName, url });
    } catch {
      return;
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-2 pb-1">
      <p className={coarse && !portrait ? 'text-sm text-hud-text-2' : 'text-base text-hud-text-2'}>
        {created ? 'Share this link so your team can walk in.' : 'Anyone you invite signs in with Google. Their address must be on the allowed list.'}
      </p>
      <input
        ref={field}
        readOnly
        value={url}
        aria-label="Office link"
        onFocus={(e) => e.currentTarget.select()}
        className={`${FIELD} min-h-12 truncate text-sm`}
      />
      {failed && <InlineAlert>We could not copy. Press and hold the link to copy it.</InlineAlert>}
      <div className="flex flex-col gap-2">
        <Button tone="primary" className="min-h-12 w-full" autoFocus={!coarse} onClick={() => void copy()}>
          {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        {share && (
          <Button className="min-h-12 w-full" onClick={() => void send()}>
            <Share2 aria-hidden className="size-4" />
            Share…
          </Button>
        )}
        {created && (
          <Button tone="ghost" className="min-h-12 w-full" onClick={onClose}>
            Not now
          </Button>
        )}
      </div>
      <p role="status" className="sr-only">
        {copied ? 'Link copied' : ''}
      </p>
    </div>
  );
}

export function InviteSheet({ url, officeName, created = false, portrait, coarse, onClose }: { url: string; officeName: string; created?: boolean; portrait: boolean; coarse: boolean; onClose: () => void }) {
  const headingId = useId();
  useEscapeLayer(true, onClose);
  const title = created ? 'Your office is ready' : `Invite people to ${officeName}`;
  const body = <InviteBody url={url} officeName={officeName} created={created} coarse={coarse} portrait={portrait} onClose={onClose} />;
  if (portrait) {
    return (
      <PortraitSheet title={title} label="Invite people" closeLabel="Close invite" onClose={onClose}>
        {body}
      </PortraitSheet>
    );
  }
  return (
    <Panel material="thick" role="dialog" aria-labelledby={headingId} className="pointer-events-auto flex w-[min(380px,50vw)] flex-col gap-2 p-2">
      <div className="flex shrink-0 items-center gap-2 pl-2">
        <PanelTitle id={headingId} className="flex-1 text-base">
          {title}
        </PanelTitle>
        <button
          type="button"
          aria-label="Close invite"
          onClick={onClose}
          className="flex min-h-12 min-w-12 items-center justify-center rounded-lg text-hud-text-2 hover:bg-hud-hover hover:text-hud-text focus-visible:outline-2 focus-visible:outline-hud-accent"
        >
          <X aria-hidden className="size-5" />
        </button>
      </div>
      {body}
    </Panel>
  );
}
