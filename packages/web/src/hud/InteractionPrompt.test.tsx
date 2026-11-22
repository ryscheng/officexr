// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ActionInput,
  createInteractionSource,
  InteractionProvider,
  InteractionStore,
  NO_PROMPT,
  type InteractionPrompt as Prompt,
} from '@officexr/world/react';
import { InteractionPrompt, SuppressInteractionPrompt } from './InteractionPrompt';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sit = { kind: 'sit', label: 'Sit', key: 'E', action: 'sit' } as const;
const stand = { kind: 'stand', label: 'Stand up', key: 'E', action: 'sit' } as const;
const ride = { kind: 'ride', label: 'Ride scooter', key: 'F', action: 'mount' } as const;
const getOff = { kind: 'dismount', label: 'Get off', key: 'F', action: 'mount' } as const;
const above = { x: 1, y: 1, z: 1 };

const setup = (coarse: boolean, prompt: Prompt, covered = false) => {
  vi.stubGlobal('matchMedia', () => ({ matches: coarse, addEventListener: () => {}, removeEventListener: () => {} }));
  const store = new InteractionStore();
  const input = new ActionInput();
  store.offer(prompt);
  render(
    <InteractionProvider source={createInteractionSource(store, input)}>
      <SuppressInteractionPrompt covered={covered} />
      <InteractionPrompt />
    </InteractionProvider>,
  );
  return { store, input };
};

describe('InteractionPrompt on touch', () => {
  it('lists each option as a button of at least 48 px, and a tap runs its key', () => {
    const { input } = setup(true, { options: [ride, sit], anchor: above });
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Sit', 'Ride scooter']);
    expect(buttons.every((b) => b.className.includes('pointer-coarse:min-h-12'))).toBe(true);
    fireEvent.click(screen.getByText('Ride scooter'));
    expect([...input.mergeInto(new Set())]).toEqual(['f']);
    fireEvent.click(screen.getByText('Sit'));
    expect([...input.mergeInto(new Set())]).toEqual(['e']);
  });

  it('stands up through the same E action', () => {
    const { input } = setup(true, { options: [stand], anchor: above });
    fireEvent.click(screen.getByText('Stand up'));
    expect([...input.mergeInto(new Set())]).toEqual(['e']);
  });

  it('shows no keycaps', () => {
    setup(true, { options: [sit], anchor: above });
    expect(document.querySelector('kbd')).toBeNull();
  });

  it('shows nothing out of reach', () => {
    setup(true, NO_PROMPT);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides while a sheet is open and returns after', () => {
    const { store } = setup(true, { options: [sit], anchor: above }, true);
    expect(screen.queryByText('Sit')).toBeNull();
    act(() => store.setSuppressed(false));
    expect(screen.getByText('Sit')).toBeTruthy();
  });

  it('hides while typing in a text field', () => {
    setup(true, { options: [sit], anchor: above });
    expect(screen.getByText('Sit')).toBeTruthy();
    const field = document.body.appendChild(document.createElement('textarea'));
    act(() => field.focus());
    expect(screen.queryByText('Sit')).toBeNull();
    act(() => field.blur());
    expect(screen.getByText('Sit')).toBeTruthy();
    field.remove();
  });
});

describe('InteractionPrompt on desktop', () => {
  it('leaves an option with an object to the world', () => {
    setup(false, { options: [sit], anchor: above });
    expect(screen.queryByText('Sit')).toBeNull();
  });

  it('shows an option without an object as a pill with its keycap', () => {
    setup(false, { options: [getOff], anchor: null });
    expect(screen.getByText('F').tagName).toBe('KBD');
    expect(screen.getByText('Get off')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
