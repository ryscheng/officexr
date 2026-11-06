// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HudLayout } from './HudLayout';
import { RotatePrompt } from './RotatePrompt';

const stubMedia = ({ coarse, portrait }: { coarse: boolean; portrait: boolean }) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: (!query.includes('pointer: coarse') || coarse) && (!query.includes('orientation: portrait') || portrait),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RotatePrompt', () => {
  it.each([
    { coarse: true, portrait: true, shown: true },
    { coarse: true, portrait: false, shown: false },
    { coarse: false, portrait: true, shown: false },
  ])('coarse=$coarse portrait=$portrait shows the prompt: $shown', ({ coarse, portrait, shown }) => {
    stubMedia({ coarse, portrait });
    render(
      <>
        <HudLayout bottomLeft={<button type="button">hud</button>} />
        <RotatePrompt />
      </>,
    );
    expect(screen.queryByRole('alert') !== null).toBe(shown);
    const hud = screen.getByRole('button', { name: 'hud' });
    expect(hud.closest('[inert],[aria-hidden="true"]')).toBeNull();
  });
});
