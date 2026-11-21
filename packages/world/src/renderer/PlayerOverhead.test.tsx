// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

const htmlCalls: { position: number[] }[] = [];
vi.mock('@react-three/drei', () => ({
  Html: ({ children, position }: { children: ReactNode; position: number[] }) => {
    htmlCalls.push({ position });
    return <>{children}</>;
  },
}));

const { PlayerOverhead } = await import('./PlayerOverhead.tsx');
const { recordCharacterHeight, overheadAnchorY } = await import('./characterHeight.ts');

afterEach(() => {
  cleanup();
  htmlCalls.length = 0;
});

function setup() {
  const store = createStore({ selfId: 'me', officeId: 'o1' });
  const bus = createBus();
  const actions = createActions(store, bus);
  actions.upsertPlayer({ id: 'me' });
  actions.upsertPlayer({ id: 'eve', name: 'Eve' });
  actions.applyRemoteHand('eve', true, 0);
  return { store, bus };
}

describe('PlayerOverhead', () => {
  it('stacks bubbles above the name tag in one anchor', () => {
    const { store, bus } = setup();
    const { container } = render(
      <PlayerOverhead
        store={store}
        bus={bus}
        playerId="eve"
        modelUrl="/o/stack.glb"
        isSelf={false}
        paused={false}
        cameraMode="fixed"
        charRadius={0.4}
      />,
    );
    const stack = container.querySelector('.player-overhead')!;
    const order = [...stack.children].map((c) => c.className);
    expect(order).toEqual(['player-bubbles', 'player-name-tag']);
    expect(htmlCalls).toHaveLength(1);
  });

  it.each([
    ['tall', 2.65],
    ['short', 1.4],
  ])('places the anchor above the head of a %s model', (_n, height) => {
    const { store, bus } = setup();
    recordCharacterHeight(`/o/${_n}.glb`, height);
    render(
      <PlayerOverhead
        store={store}
        bus={bus}
        playerId="eve"
        modelUrl={`/o/${_n}.glb`}
        isSelf={false}
        paused={false}
        cameraMode="fixed"
        charRadius={0.4}
      />,
    );
    expect(htmlCalls.at(-1)!.position).toEqual([0, overheadAnchorY(height), 0]);
  });

  it('shows the bell between the bubbles and the tag only while hovered', () => {
    const { store, bus } = setup();
    const { container } = render(
      <PlayerOverhead
        store={store}
        bus={bus}
        playerId="eve"
        modelUrl="/o/bell.glb"
        isSelf={false}
        paused={false}
        cameraMode="fixed"
        charRadius={0.4}
        onPing={() => {}}
      />,
    );
    const stack = container.querySelector('.player-overhead')!;
    expect(stack.querySelector('.player-ping-bell')).toBeNull();
    fireEvent.pointerEnter(stack);
    expect([...stack.children].map((c) => c.className)).toEqual([
      'player-bubbles',
      'player-ping-bell',
      'player-name-tag',
    ]);
    fireEvent.pointerLeave(stack);
    expect(stack.querySelector('.player-ping-bell')).toBeNull();
  });
});
