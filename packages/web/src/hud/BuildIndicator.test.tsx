// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { PLACEABLE_KINDS } from '@officexr/sdk';
import { createPlaceMode } from '@officexr/world/motion';
import { afterEach, describe, expect, it } from 'vitest';
import { BuildIndicator } from './BuildIndicator';

afterEach(cleanup);

describe('BuildIndicator', () => {
  it('is absent while build mode is closed', () => {
    render(<BuildIndicator mode={createPlaceMode()} />);
    expect(screen.queryByRole('status', { name: 'Build mode' })).toBeNull();
  });

  it('shows the selected prop and the keys while open, and follows the selection', () => {
    const mode = createPlaceMode();
    render(<BuildIndicator mode={mode} />);
    act(() => mode.setOpen(true));
    expect(screen.getByText(PLACEABLE_KINDS[0].label)).toBeTruthy();
    for (const [key, action] of [['Tab', 'next prop'], ['R', 'rotate'], ['Enter', 'place'], ['B', 'close']]) {
      expect(screen.getByText(key!)).toBeTruthy();
      expect(screen.getByText(action!)).toBeTruthy();
    }
    act(() => mode.selectKind(PLACEABLE_KINDS[2].kindId));
    expect(screen.getByText(PLACEABLE_KINDS[2].label)).toBeTruthy();
    expect(screen.queryByText(PLACEABLE_KINDS[0].label)).toBeNull();
  });

  it('shows a placement notice and hides again on close', () => {
    const mode = createPlaceMode();
    render(<BuildIndicator mode={mode} />);
    act(() => {
      mode.setOpen(true);
      mode.setNotice('Something is in the way');
    });
    expect(screen.getByText('Something is in the way')).toBeTruthy();
    act(() => mode.setOpen(false));
    expect(screen.queryByRole('status', { name: 'Build mode' })).toBeNull();
  });
});
