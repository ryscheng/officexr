// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RotatePrompt } from './RotatePrompt';

const stubMedia = (matches: boolean) =>
  vi.stubGlobal('matchMedia', () => ({ matches, addEventListener: () => {}, removeEventListener: () => {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWithHud() {
  render(
    <>
      <button type="button">hud</button>
      <RotatePrompt />
    </>,
  );
}

describe('RotatePrompt', () => {
  it('overlays the prompt on a coarse pointer held upright while the HUD stays mounted', () => {
    stubMedia(true);
    renderWithHud();
    expect(screen.getByText('Turn your phone')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'hud' })).toBeTruthy();
  });

  it('renders nothing on a fine pointer or in landscape', () => {
    stubMedia(false);
    renderWithHud();
    expect(screen.queryByText('Turn your phone')).toBeNull();
    expect(screen.getByRole('button', { name: 'hud' })).toBeTruthy();
  });
});
