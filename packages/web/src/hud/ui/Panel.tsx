import type { ComponentProps } from 'react';

/** Section and panel titles: the system font, semibold, sentence case, like macOS window titles. */
export const TITLE_TEXT = 'font-hud-title font-semibold tracking-tight text-hud-text';

/**
 * The frosted materials: `regular` for floating HUD panels, `thick` for modals that sit over a
 * busy world. Each is blur, a hairline light rim and a soft lift.
 */
const MATERIAL = {
  regular: 'hud-glass border border-hud-edge shadow-hud-panel',
  thick: 'hud-glass-thick border border-hud-edge shadow-hud-panel',
} as const;

/** A compact control-sized glass surface, e.g. a folded panel's tab. */
export const CHIP = 'rounded-hud-control hud-glass border border-hud-edge text-hud-text shadow-hud-control hover:bg-hud-panel-thick';

/** The `data-studio-panel` attribute keeps typing inside from driving the avatar. */
export function Panel({ className = '', material = 'regular', ...props }: ComponentProps<'div'> & { material?: keyof typeof MATERIAL }) {
  return <div data-studio-panel className={`rounded-hud-panel font-hud-body text-hud-text ${MATERIAL[material]} ${className}`} {...props} />;
}

export function PanelTitle({ className = 'text-sm', ...props }: ComponentProps<'h2'>) {
  return <h2 className={`${TITLE_TEXT} ${className}`} {...props} />;
}
