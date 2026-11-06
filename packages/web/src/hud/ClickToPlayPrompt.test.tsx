// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { focusWorld } from '@officexr/world/top-down';
import { ClickToPlayPrompt } from './ClickToPlayPrompt';

afterEach(cleanup);

it('shows on focus loss and hides when the world is refocused', () => {
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
