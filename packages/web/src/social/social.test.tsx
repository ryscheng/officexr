// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { createViewYaw, PlayControlsProvider, ViewYawProvider } from '@officexr/world/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '../hud/ChatPanel';
import { fakePlayControls } from '../hud/fakePlayControls';
import { createLocalMutes } from '../hud/localMutes';
import { PeopleSheet } from '../hud/PeopleSheet';
import { SocialProvider } from './SocialProvider';

const ALL = { block: true, report: true, nearbyChat: true, directChat: true };

type Call = { method: string; path: string; body: unknown };

function stubServer(caps: typeof ALL | null, { reportStatus = 201, blockOk = true }: { reportStatus?: number; blockOk?: boolean } = {}) {
  const calls: Call[] = [];
  let blocks: Array<{ login: string; name: string | null }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const json = (status: number, data: unknown) => ({ ok: status < 400, status, json: async () => data }) as Response;
      if (path === '/api/social') {
        return caps ? json(200, caps) : json(404, { error: 'Not found' });
      }
      if (path === '/api/reports') {
        return json(reportStatus, {});
      }
      if (path.startsWith('/api/blocks') && !caps) {
        return json(404, { error: 'Not found' });
      }
      if (path.startsWith('/api/blocks/') && !blockOk) {
        return json(500, { error: 'x' });
      }
      const login = decodeURIComponent(path.slice('/api/blocks/'.length));
      if (method === 'PUT') {
        blocks = [...blocks, { login, name: body.name }];
      } else if (method === 'DELETE') {
        blocks = blocks.filter((b) => b.login !== login);
      }
      return json(200, { blocks });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

function seedStore() {
  const store = createStore({ selfId: 'me@x.io', officeId: 'o' });
  const actions = createActions(store, createBus());
  actions.upsertPlayer({ id: 'me@x.io', name: 'Me', pos: { x: 0, y: 0, z: 0 } });
  actions.upsertPlayer({ id: 'bob@x.io', name: 'Bob', pos: { x: 1, y: 0, z: 0 } });
  actions.upsertPlayer({ id: 'cat@x.io', name: 'Cat', pos: { x: 2, y: 0, z: 0 } });
  return { store, actions };
}

function renderSheet(onClose = vi.fn()) {
  const { store } = seedStore();
  const play = fakePlayControls();
  render(
    <SocialProvider officeId="o1" officeName="HQ">
      <PlayControlsProvider controls={play.controls}>
        <ViewYawProvider viewYaw={createViewYaw()}>
          <PeopleSheet store={store} selfId="me@x.io" officeName="HQ" mutes={createLocalMutes(null)} portrait={false} onWave={() => {}} onInvite={() => {}} onClose={onClose} />
        </ViewYawProvider>
      </PlayControlsProvider>
    </SocialProvider>,
  );
}

const openBob = () => fireEvent.click(screen.getByRole('button', { name: /^Bob, .*Show options$/ }));

describe('person card against a server without the social routes', () => {
  it('has no Message and no More, and keeps Go, Wave, Mute for me and Ping', async () => {
    const calls = stubServer(null);
    renderSheet();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/social')).toBe(true));
    openBob();
    expect(screen.getByRole('button', { name: 'Go to Bob' })).toBeTruthy();
    for (const name of ['Wave', 'Mute for me', 'Ping']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More…' })).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/api/blocks'))).toBe(false);
  });
});

describe('person card against a server with the social routes', () => {
  it('blocks from More, tells who was blocked, and undoes it', async () => {
    const calls = stubServer(ALL);
    renderSheet();
    openBob();
    fireEvent.click(await screen.findByRole('button', { name: 'More…' }));
    expect(screen.getByText('You will not see or hear each other.')).toBeTruthy();
    expect(screen.getByText('Tell an admin about a problem.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Block Bob/ }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', expect.stringContaining('Blocked Bob.'));
    expect(calls.find((c) => c.method === 'PUT')).toEqual({ method: 'PUT', path: '/api/blocks/bob%40x.io', body: { name: 'Bob' } });
    const blocked = screen.getByRole('region', { name: 'Blocked people' });
    expect(within(blocked).getByText('Bob')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Blocked people' })).toBeNull());
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/blocks/bob%40x.io')).toBe(true);
  });

  it('unblocks from the blocked list', async () => {
    const calls = stubServer(ALL);
    renderSheet();
    openBob();
    fireEvent.click(await screen.findByRole('button', { name: 'More…' }));
    fireEvent.click(screen.getByRole('button', { name: /Block Bob/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unblock Bob' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });

  it('says so when the block did not go through, and stays on the card', async () => {
    stubServer(ALL, { blockOk: false });
    renderSheet();
    openBob();
    fireEvent.click(await screen.findByRole('button', { name: 'More…' }));
    fireEvent.click(screen.getByRole('button', { name: /Block Bob/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not block. Try again.');
    expect(screen.getByRole('button', { name: /Block Bob/ })).toBeTruthy();
  });

  it('sends a report with a reason from the list and an optional note', async () => {
    const calls = stubServer(ALL);
    renderSheet();
    openBob();
    fireEvent.click(await screen.findByRole('button', { name: 'More…' }));
    fireEvent.click(screen.getByRole('button', { name: /Report Bob/ }));
    const send = screen.getByRole('button', { name: 'Send report' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Spam' }));
    fireEvent.change(screen.getByLabelText('Add a note (optional)'), { target: { value: 'sells things' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect((await screen.findByRole('status')).textContent).toContain('An admin will look at your report about Bob.');
    expect(calls.find((c) => c.path === '/api/reports')?.body).toEqual({ officeId: 'o1', login: 'bob@x.io', reason: 'spam', note: 'sells things' });
  });

  it.each([
    [429, 'You sent a report a moment ago. Wait a minute, then try again.'],
    [500, 'The report did not send. Try again.'],
  ])('keeps the form and explains a %s answer', async (status, message) => {
    stubServer(ALL, { reportStatus: status });
    renderSheet();
    openBob();
    fireEvent.click(await screen.findByRole('button', { name: 'More…' }));
    fireEvent.click(screen.getByRole('button', { name: /Report Bob/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Harassment or bullying' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    expect((screen.getByRole('button', { name: 'Send report' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('chat scope', () => {
  const setup = () => {
    const { store, actions } = seedStore();
    render(
      <SocialProvider officeId="o1" officeName="HQ">
        <ChatPanel store={store} actions={actions} selfId="me@x.io" />
      </SocialProvider>,
    );
    act(() => void fireEvent.keyDown(window, { key: 'Enter' }));
    return { store };
  };
  const type = (text: string) => {
    const field = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(field, { target: { value: text } });
    fireEvent.keyDown(field, { key: 'Enter' });
  };

  it('shows no scope line against a server without scopes', async () => {
    const calls = stubServer(null);
    setup();
    await waitFor(() => expect(calls.some((c) => c.path === '/api/social')).toBe(true));
    expect(screen.queryByLabelText('To')).toBeNull();
    type('hello');
  });

  it('sends to everyone by default, then nearby, then to one person', async () => {
    stubServer(ALL);
    const { store } = setup();
    const scope = (await screen.findByLabelText('To')) as HTMLSelectElement;
    expect(within(scope).getAllByRole('option').map((o) => o.textContent)).toEqual(['Everyone in HQ', 'People nearby', 'Bob', 'Cat']);
    type('all');
    fireEvent.change(scope, { target: { value: 'nearby' } });
    type('close');
    fireEvent.change(scope, { target: { value: 'direct:bob@x.io' } });
    expect(screen.getByPlaceholderText('Message Bob')).toBeTruthy();
    type('just you');
    expect(store.getState().chat.map((m) => [m.text, m.scope, m.to])).toEqual([
      ['all', undefined, undefined],
      ['close', 'nearby', undefined],
      ['just you', 'direct', 'bob@x.io'],
    ]);
    expect(screen.getByText('(nearby)')).toBeTruthy();
    expect(screen.getByText('(private, to Bob)')).toBeTruthy();
  });

  it('falls back to everyone when the person chosen leaves', async () => {
    stubServer(ALL);
    const { store } = setup();
    const scope = (await screen.findByLabelText('To')) as HTMLSelectElement;
    fireEvent.change(scope, { target: { value: 'direct:cat@x.io' } });
    act(() => createActions(store, createBus()).removePlayer('cat@x.io'));
    expect(scope.value).toBe('everyone');
    type('anyone there');
    expect(store.getState().chat.at(-1)?.scope).toBeUndefined();
  });

  it('labels a private message from someone else', async () => {
    stubServer(ALL);
    const { store } = setup();
    await screen.findByLabelText('To');
    act(() => createActions(store, createBus()).applyRemoteChat({ id: 'x', authorId: 'bob@x.io', text: 'psst', t: 1, scope: 'direct', to: 'me@x.io' }));
    expect(screen.getByText('(private)')).toBeTruthy();
  });
});
