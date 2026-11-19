import { Hand, SmilePlus } from 'lucide-react';
import { EMOTE_IDS, EMOTE_INFO } from '@officexr/sdk';
import { focusWorld } from '@officexr/world/top-down';
import { IconButton } from '../hud/IconButton';
import { useEscapeLayer } from '../hud/useEscapeLayer';
import { Keycap } from '../hud/ui/Keycap';
import { Panel, PanelTitle } from '../hud/ui/Panel';
import { useStatusHud } from './SelfStatusProvider';

/** The emote picker button with its popover, and the raise-hand toggle beside it. */
export function EmoteMenu() {
  const hud = useStatusHud();
  const open = hud?.emoteMenuOpen ?? false;
  useEscapeLayer(open, () => {
    hud?.setEmoteMenuOpen(false);
    focusWorld();
  });
  if (!hud) {
    return null;
  }
  const { handRaised, toggleHand, setEmoteMenuOpen, sendEmote } = hud;
  return (
    <>
      <IconButton
        icon={Hand}
        label={handRaised ? 'Lower your hand' : 'Raise your hand'}
        pressed={handRaised}
        tone={handRaised ? 'accent' : 'neutral'}
        onClick={() => {
          toggleHand();
          focusWorld();
        }}
      />
      <div data-studio-panel className="pointer-events-none relative flex">
        <IconButton
          icon={SmilePlus}
          label="Emotes"
          expanded={open}
          onClick={() => {
            setEmoteMenuOpen(!open);
            if (open) {
              focusWorld();
            }
          }}
        />
        {open && (
          <Panel className="pointer-events-auto absolute top-full right-0 z-10 mt-2 w-56 p-2 text-xs">
            <PanelTitle className="mb-1 text-xs">Emotes</PanelTitle>
            <ul aria-label="Emotes" className="grid grid-cols-4 gap-1">
              {EMOTE_IDS.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    aria-label={EMOTE_INFO[id].label}
                    title={EMOTE_INFO[id].label}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      sendEmote(id);
                      setEmoteMenuOpen(false);
                      focusWorld();
                    }}
                    className="h-11 w-full rounded-hud-control bg-hud-inset text-xl hover:bg-hud-hover"
                  >
                    {EMOTE_INFO[id].glyph}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-hud-text-2">
              <Keycap>R</Keycap> emotes, <Keycap>H</Keycap> raise hand
            </p>
          </Panel>
        )}
      </div>
    </>
  );
}
