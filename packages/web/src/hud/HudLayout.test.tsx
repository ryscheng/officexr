// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { HudLayout } from './HudLayout';

afterEach(cleanup);

it('puts each slot in its own zone', () => {
  const slots = ['topLeft', 'topCentre', 'topRight', 'rightEdge', 'bottomCentre', 'bottomLeft'] as const;
  render(<HudLayout {...Object.fromEntries(slots.map((slot) => [slot, <span>{slot} child</span>]))} />);
  for (const slot of slots) {
    expect(screen.getByText(`${slot} child`).closest<HTMLElement>('[data-hud-zone]')?.dataset.hudZone).toBe(slot);
  }
});
