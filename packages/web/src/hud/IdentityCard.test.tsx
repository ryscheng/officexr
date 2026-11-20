// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createActions, createBus, createStore } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityCard } from './IdentityCard';

afterEach(cleanup);

const setup = (props: Partial<Parameters<typeof IdentityCard>[0]> = {}) => {
  const store = createStore({ selfId: 'me', officeId: 'o' });
  createActions(store, createBus()).upsertPlayer({ id: 'me', name: 'Avery Preview', statusText: 'Heads down' });
  const onChat = vi.fn();
  const onMenu = vi.fn();
  render(<IdentityCard store={store} officeName="HQ" unread={0} chatOpen={false} menuOpen={false} onChat={onChat} onMenu={onMenu} {...props} />);
  return { onChat, onMenu };
};

describe('IdentityCard', () => {
  it('shows who you are, your status and the office', () => {
    setup();
    expect(screen.getByText('Avery Preview')).toBeTruthy();
    expect(screen.getByText('Heads down · HQ')).toBeTruthy();
  });

  it('falls back to the presence label without a status text', () => {
    const store = createStore({ selfId: 'me', officeId: 'o' });
    createActions(store, createBus()).upsertPlayer({ id: 'me', name: 'Avery' });
    render(<IdentityCard store={store} officeName="HQ" unread={0} chatOpen={false} menuOpen={false} onChat={() => {}} onMenu={() => {}} />);
    expect(screen.getByText('Available · HQ')).toBeTruthy();
  });

  it('chat and menu buttons call back, and the chat button counts unread messages', () => {
    const { onChat, onMenu } = setup({ unread: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'Chat, 2 new' }));
    fireEvent.click(screen.getByRole('button', { name: 'Office menu' }));
    expect(onChat).toHaveBeenCalledTimes(1);
    expect(onMenu).toHaveBeenCalledTimes(1);
  });
});
