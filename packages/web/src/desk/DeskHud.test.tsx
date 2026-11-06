// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayControlsProvider, type PlayControlsSource } from '@officexr/world/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakePlayControls } from '../hud/fakePlayControls';
import { DeskHud } from './DeskHud';
import { deskWorld, ME } from './fixtures';
import type { RequestDeskClaim } from './requestDeskClaim';

afterEach(cleanup);

const renderHud = (
  world: ReturnType<typeof deskWorld>,
  requestDeskClaim: RequestDeskClaim = () => Promise.resolve({ ok: true }),
  controls: PlayControlsSource = fakePlayControls().controls,
) =>
  render(
    <PlayControlsProvider controls={controls}>
      <DeskHud store={world.store} requestDeskClaim={requestDeskClaim} />
    </PlayControlsProvider>,
  );

describe('DeskHud banner', () => {
  it('offers to claim an unclaimed area, and to move when a desk is already owned', () => {
    const world = deskWorld();
    const request = vi.fn<RequestDeskClaim>(() => Promise.resolve({ ok: true }));
    renderHud(world, request);
    expect(screen.getByText('Claim desk')).toBeTruthy();
    expect(screen.queryByText('Unclaim desk')).toBeNull();

    act(() => world.actions.setDeskAreas([...world.store.getState().deskAreas, { id: 'd2', label: 'B', min: { x: 20, z: 20 }, max: { x: 24, z: 24 }, seatInstanceId: null }]));
    act(() => world.actions.setDeskClaims({ d2: ME }));
    expect(screen.getByText('Unclaim desk')).toBeTruthy();
    fireEvent.click(screen.getByText('Move desk here'));
    expect(request).toHaveBeenCalledWith('d1');
  });

  it('names the owner, by display name while online and by login otherwise', () => {
    const world = deskWorld();
    renderHud(world);
    act(() => world.actions.setDeskClaims({ d1: ME }));
    expect(screen.getByText('Your desk')).toBeTruthy();

    act(() => world.actions.setDeskClaims({ d1: 'bob@example.com' }));
    expect(screen.getByText("bob@example.com's desk")).toBeTruthy();
    act(() => world.actions.upsertPlayer({ id: 'bob@example.com#1', name: 'Bob' }));
    expect(screen.getByText("Bob's desk")).toBeTruthy();
  });

  it('shows nothing outside every desk area', () => {
    const { container } = renderHud(deskWorld({ x: 50, y: 0, z: 50 }));
    expect(container.textContent).toBe('');
  });
});

describe('DeskHud requests', () => {
  it('disables the button while pending and toasts a rejection', async () => {
    let settle: (r: Awaited<ReturnType<RequestDeskClaim>>) => void = () => {};
    const request = vi.fn<RequestDeskClaim>(() => new Promise((resolve) => void (settle = resolve)));
    renderHud(deskWorld(), request);
    fireEvent.click(screen.getByText('Claim desk'));
    expect(request).toHaveBeenCalledWith('d1');
    expect((screen.getByText('Claim desk') as HTMLButtonElement).disabled).toBe(true);

    await act(async () => settle({ ok: false, error: 'taken' }));
    expect(screen.getByText('Desk already taken')).toBeTruthy();
    expect((screen.getByText('Claim desk') as HTMLButtonElement).disabled).toBe(false);
  });

  it('unclaims with a null desk', () => {
    const world = deskWorld({ x: 50, y: 0, z: 50 });
    world.actions.setDeskClaims({ d1: ME });
    const request = vi.fn<RequestDeskClaim>(() => Promise.resolve({ ok: true }));
    renderHud(world, request);
    fireEvent.click(screen.getByText('Unclaim desk'));
    expect(request).toHaveBeenCalledWith(null);
  });
});

describe('return to desk', () => {
  const withSeating = (seating: { nearbySeatId: string | null; hasDesk: boolean }) => {
    const { controls } = fakePlayControls();
    const returnToDesk = vi.fn();
    const sit = vi.fn();
    return { controls: { ...controls, getSeating: () => seating, returnToDesk, sit }, returnToDesk, sit };
  };

  it('is a button when the user has a desk and answers Alt+D, but not while typing or in a dialog', () => {
    const { controls, returnToDesk } = withSeating({ nearbySeatId: null, hasDesk: true });
    renderHud(deskWorld(), undefined, controls);
    fireEvent.click(screen.getByText('Return to desk'));
    expect(returnToDesk).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { code: 'KeyD' });
    expect(returnToDesk).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { code: 'KeyD', altKey: true });
    expect(returnToDesk).toHaveBeenCalledTimes(2);

    const input = document.body.appendChild(document.createElement('input'));
    fireEvent.keyDown(input, { code: 'KeyD', altKey: true });
    expect(returnToDesk).toHaveBeenCalledTimes(2);
    input.remove();
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    fireEvent.keyDown(window, { code: 'KeyD', altKey: true });
    expect(returnToDesk).toHaveBeenCalledTimes(2);
    dialog.remove();
  });

  it('hides the button without a desk, and offers Sit only next to a seat', () => {
    const none = withSeating({ nearbySeatId: null, hasDesk: false });
    renderHud(deskWorld(), undefined, none.controls);
    expect(screen.queryByText('Return to desk')).toBeNull();
    expect(screen.queryByText('Sit')).toBeNull();
    cleanup();

    const near = withSeating({ nearbySeatId: 'chair', hasDesk: false });
    renderHud(deskWorld(), undefined, near.controls);
    fireEvent.click(screen.getByText('Sit'));
    expect(near.sit).toHaveBeenCalledWith();
  });
});
