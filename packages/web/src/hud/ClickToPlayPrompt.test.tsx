// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { focusWorld } from '@officexr/world/top-down';
import { ClickToPlayPrompt } from './ClickToPlayPrompt';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stubPointer = (coarse: boolean) =>
  vi.stubGlobal('matchMedia', () => ({ matches: coarse, addEventListener: () => {}, removeEventListener: () => {} }));

it('shows on focus loss and hides when the world is refocused', () => {
  stubPointer(false);
  render(
    <>
      <aside data-studio-panel="true">
        <button>in panel</button>
      </aside>
      <ClickToPlayPrompt />
    </>,
  );
  expect(screen.queryByText('Click to play')).toBeNull();
  fireEvent.mouseDown(screen.getByText('in panel'));
  expect(screen.getByText('Click to play')).toBeTruthy();
  act(() => focusWorld());
  expect(screen.queryByText('Click to play')).toBeNull();
});

it('stays hidden on a touch screen, which has no keyboard focus to lose', () => {
  stubPointer(true);
  render(
    <>
      <aside data-studio-panel="true">
        <button>in panel</button>
      </aside>
      <ClickToPlayPrompt />
    </>,
  );
  fireEvent.mouseDown(screen.getByText('in panel'));
  expect(screen.queryByText('Click to play')).toBeNull();
});
