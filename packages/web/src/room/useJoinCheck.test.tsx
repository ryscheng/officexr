// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JoinPrompt } from './JoinPrompt';
import { useJoinCheck } from './useJoinCheck';

afterEach(cleanup);

function Probe({ fetchFn }: { fetchFn: typeof fetch }) {
  const { state, join, cancel } = useJoinCheck('my office', 'a@example.com', fetchFn);
  return (
    <>
      <p>state:{state}</p>
      {state === 'prompt' && <JoinPrompt onJoin={join} onCancel={cancel} />}
    </>
  );
}

function setup(fetchFn: typeof fetch) {
  render(
    <MemoryRouter initialEntries={['/room/o1']}>
      <Routes>
        <Route path="/" element={<p>Home</p>} />
        <Route path="/room/:id" element={<Probe fetchFn={fetchFn} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const answer = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body }) as Response) as unknown as typeof fetch;
const PROMPT = /Joining here will disconnect it/;

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

  it('prompts when already connected, and Join anyway proceeds', async () => {
    setup(answer({ connected: true, allowMulti: false }));
    expect(await screen.findByText(PROMPT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Join anyway' }));
    await screen.findByText('state:go');
  });

  it('navigates home on Cancel', async () => {
    setup(answer({ connected: true, allowMulti: false }));
    await screen.findByText(PROMPT);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByText('Home')).toBeTruthy());
  });

  it('joins without a prompt when the check fails', async () => {
    setup(vi.fn(async () => Promise.reject(new Error('down'))) as unknown as typeof fetch);
    await screen.findByText('state:go');
    expect(screen.queryByText(PROMPT)).toBeNull();
  });
});
