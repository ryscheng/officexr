// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { applyNetEventToStore, createActions, createBus, createStore, validateNetEvent } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-three/drei', () => ({ Html: ({ children }: { children: ReactNode }) => <>{children}</> }));

const { PlayerNameTag } = await import('./PlayerNameTag.tsx');

afterEach(cleanup);

function remoteStatus(rich: Record<string, unknown>) {
  const store = createStore({ selfId: 'me', officeId: 'o1' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me' });
  actions.upsertPlayer({ id: 'eve', name: 'Eve' });
  const raw = {
    kind: 'presence:status',
    v: 1,
    actorId: 'eve',
    seq: 1,
    t: 0,
    status: 'available',
    mic: 'none',
    ...rich,
  };
  const v = validateNetEvent(raw);
  if (v.ok) applyNetEventToStore(actions, v.event, { now: () => 0 });
  return store;
}

describe('adv2: name tag with hostile status fields', () => {
  it('renders HTML in the status text as text, not markup', () => {
    const store = remoteStatus({ statusText: '<img src=x onerror="window.__xss=1">' });
    const { container } = render(<PlayerNameTag store={store} playerId="eve" isSelf={false} paused={false} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('accepts only an emoji in the emoji field', () => {
    const store = remoteStatus({ statusEmoji: '[ADMIN] Boss' });
    const { container } = render(<PlayerNameTag store={store} playerId="eve" isSelf={false} paused={false} />);
    expect(store.getState().players['eve']?.statusEmoji ?? null).toBeNull();
  });
});
