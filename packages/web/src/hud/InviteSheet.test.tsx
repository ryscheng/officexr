// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteSheet } from './InviteSheet';

const URL_ = 'https://office.example.test/room/abc';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'execCommand');
});

const open = (props: Partial<Parameters<typeof InviteSheet>[0]> = {}) =>
  render(<InviteSheet url={URL_} officeName="HQ" portrait={false} coarse={false} onClose={() => {}} {...props} />);

describe('InviteSheet', () => {
  it('shows the link and the sign-in sentence', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Invite people to HQ' })).toBeTruthy();
    expect((screen.getByLabelText('Office link') as HTMLInputElement).value).toBe(URL_);
    expect(screen.getByText('Anyone you invite signs in with Google. Their address must be on the allowed list.')).toBeTruthy();
  });

  it('copies the link and shows Copied for two seconds', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    open();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Link copied');
    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('selects the link and tries the copy command when the clipboard throws', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    open();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    const field = screen.getByLabelText('Office link') as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(URL_.length);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('tells the person to press and hold when nothing can copy', async () => {
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', { value: () => false, configurable: true });
    open();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy link' })));
    expect(screen.getByRole('alert').textContent).toBe('We could not copy. Press and hold the link to copy it.');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy();
  });

  it('hides Share when the browser cannot share', () => {
    vi.stubGlobal('navigator', {});
    open();
    expect(screen.queryByRole('button', { name: 'Share…' })).toBeNull();
  });

  it('shares the link when the browser can, and ignores a cancelled share', async () => {
    const share = vi.fn(() => Promise.reject(new DOMException('cancelled', 'AbortError')));
    vi.stubGlobal('navigator', { share });
    open();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share…' })));
    expect(share).toHaveBeenCalledWith({ title: 'HQ', url: URL_ });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the one-time variant with Not now after Create', () => {
    const onClose = vi.fn();
    open({ created: true, onClose });
    expect(screen.getByRole('dialog', { name: 'Your office is ready' })).toBeTruthy();
    expect(screen.getByText('Share this link so your team can walk in.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('has no Not now button when opened from the menu', () => {
    open();
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
  });

  it('closes with the close button, and as a bottom sheet in portrait', () => {
    const onClose = vi.fn();
    open({ portrait: true, onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Close invite' }));
    expect(onClose).toHaveBeenCalled();
  });
});
