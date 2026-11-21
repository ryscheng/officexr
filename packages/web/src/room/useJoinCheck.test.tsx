// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { apiFetch } from '../apiOrigin';
import { JoinPrompt } from './JoinPrompt';
import { useJoinCheck } from './useJoinCheck';

afterEach(cleanup);

function Probe({ fetchFn }: { fetchFn: typeof apiFetch }) {
  const { state, join } = useJoinCheck('my office', 'a@example.com', fetchFn);
  return (
    <>
      <p>state:{state}</p>
      {state === 'prompt' && <JoinPrompt onJoin={join} />}
    </>
  );
}

const setup = (fetchFn: typeof apiFetch) => render(<Probe fetchFn={fetchFn} />);

const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body }) as Response;
/** Answers the sessions check with `body`, and the token request with `tokenStatus` (404 means no token). */
const answer = (body: unknown, tokenStatus = 404) =>
  vi.fn(async (url: string) => (url === '/api/realtime-token' ? reply(tokenStatus, { token: 'a.b' }) : reply(200, body))) as unknown as typeof apiFetch;
const PROMPT = 'You are in this office in another window';

describe('useJoinCheck', () => {
  it.each([
    ['nobody is connected', { connected: false, allowMulti: false }],
    ['multiple sessions are allowed', { connected: true, allowMulti: true }],
  ])('joins without a prompt when %s', async (_, body) => {
    const fetchFn = answer(body);
    setup(fetchFn);
    await screen.findByText('state:go');
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(fetchFn).toHaveBeenCalledWith('/rooms/my%20office/sessions?login=a%40example.com');
  });

  it('appends the realtime token to the check when one is issued', async () => {
    const fetchFn = answer({ connected: false, allowMulti: false }, 200);
    setup(fetchFn);
    await screen.findByText('state:go');
    expect(fetchFn).toHaveBeenCalledWith('/rooms/my%20office/sessions?login=a%40example.com&token=a.b');
  });

  it('joins without a prompt when the token request fails', async () => {
    setup(answer({ connected: true, allowMulti: false }, 500));
    await screen.findByText('state:go');
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('prompts when already connected, and Use this window proceeds', async () => {
    setup(answer({ connected: true, allowMulti: false }));
    expect(await screen.findByText(PROMPT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this window' }));
    await screen.findByText('state:go');
  });

  it('links back to the offices from the prompt', async () => {
    setup(answer({ connected: true, allowMulti: false }));
    await screen.findByText(PROMPT);
    expect(screen.getByRole('link', { name: 'Back to offices' }).getAttribute('href')).toBe('/');
  });

  it('joins without a prompt when the check fails', async () => {
    setup(vi.fn(async () => Promise.reject(new Error('down'))) as unknown as typeof apiFetch);
    await screen.findByText('state:go');
    expect(screen.queryByText(PROMPT)).toBeNull();
  });
});
