import { useEffect, useId, useState, type FormEvent } from 'react';
import { BellOff, MessageSquare } from 'lucide-react';
import { STATUS_TEXT_MAX } from '@officexr/sdk';
import { focusWorld } from '@officexr/world/top-down';
import { IconButton } from '../hud/IconButton';
import { useEscapeLayer } from '../hud/useEscapeLayer';
import { Button } from '../hud/ui/Button';
import { FIELD } from '../hud/ui/fieldStyles';
import { Keycap } from '../hud/ui/Keycap';
import { Panel, PanelTitle } from '../hud/ui/Panel';
import { Switch } from '../hud/ui/Switch';
import { useStatusHud, type StatusHud } from './SelfStatusProvider';

export const QUICK_EMOJI = ['💬', '📝', '🎧', '🍽️', '🏠', '🤒', '🌴', '🚀'] as const;

const chipLabel = (s: Pick<StatusHud, 'text' | 'focus'>) =>
  s.focus ? 'Status: focus mode' : s.text ? `Status: ${s.text}` : 'Set a status';

export function StatusMenu() {
  const hud = useStatusHud();
  if (!hud) {
    return null;
  }
  return <StatusMenuBody hud={hud} />;
}

function StatusMenuBody({ hud }: { hud: StatusHud }) {
  const { text, emoji, focus, setStatus, toggleFocus, statusMenuOpen: open, setStatusMenuOpen: setOpen } = hud;
  const [draft, setDraft] = useState(text);
  const inputId = useId();
  useEffect(() => {
    if (open) {
      setDraft(text);
    }
  }, [open, text]);
  const close = () => {
    setOpen(false);
    focusWorld();
  };
  useEscapeLayer(open, close);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setStatus({ text: draft });
    close();
  };

  return (
    <div data-studio-panel className="pointer-events-none relative flex">
      <IconButton
        icon={focus ? BellOff : MessageSquare}
        label={chipLabel(hud)}
        pressed={focus}
        tone={focus ? 'accent' : 'neutral'}
        expanded={open}
        onClick={() => {
          setOpen(!open);
          if (open) {
            focusWorld();
          }
        }}
      />
      {emoji && !focus && (
        <span aria-hidden className="pointer-events-none absolute -top-1.5 -right-1.5 text-sm leading-none">
          {emoji}
        </span>
      )}
      {open && (
        <Panel className="pointer-events-auto absolute top-full right-0 z-10 mt-2 w-64 p-3 text-xs">
          <form onSubmit={submit} className="flex flex-col gap-2">
            <PanelTitle className="text-xs">Your status</PanelTitle>
            <div role="group" aria-label="Status emoji" className="flex flex-wrap gap-1">
              {QUICK_EMOJI.map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-label={`Use ${e}`}
                  aria-pressed={emoji === e}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => setStatus({ emoji: emoji === e ? '' : e })}
                  className={`h-7 w-7 rounded-hud-control text-base ${emoji === e ? 'bg-hud-accent' : 'bg-hud-inset hover:bg-hud-hover'}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <label htmlFor={inputId} className="sr-only">
              Status text
            </label>
            <input
              id={inputId}
              className={FIELD}
              value={draft}
              maxLength={STATUS_TEXT_MAX}
              placeholder="What are you up to?"
              autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setStatus({ text: draft })}
            />
            <span className="text-hud-text-2 tabular-nums">
              {draft.length}/{STATUS_TEXT_MAX}
            </span>
            <label className="flex items-center justify-between gap-2">
              <span>
                <span className="block font-semibold">Focus mode</span>
                <span className="block text-hud-text-2">Silences pings and pokes for you. Others see a focus icon.</span>
              </span>
              <Switch aria-label="Focus mode" checked={focus} onCheckedChange={toggleFocus} />
            </label>
            <div className="flex items-center justify-between gap-2">
              <span className="text-hud-text-2">
                <Keycap>Alt</Keycap> <Keycap>N</Keycap> toggles focus
              </span>
              <span className="flex gap-1">
                <Button
                  size="sm"
                  tone="ghost"
                  disabled={!text && !emoji}
                  onClick={() => {
                    setDraft('');
                    setStatus({ text: '', emoji: '' });
                  }}
                >
                  Clear
                </Button>
                <Button size="sm" tone="primary" type="submit">
                  Save
                </Button>
              </span>
            </div>
          </form>
        </Panel>
      )}
    </div>
  );
}
