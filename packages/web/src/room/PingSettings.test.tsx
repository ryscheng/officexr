// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SoundCatalog } from '@officexr/world/app';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPingPrefs, writePingPrefs, DEFAULT_PING_PREFS } from '../ping/pingPrefs';
import type { NotificationSeam } from '../ping/pingNotifier';
import { PingSettingsDialog } from './PingSettings';

const CATALOG = { sounds: [{ name: 'bell' }, { name: 'horn' }] } as SoundCatalog;

beforeEach(() => writePingPrefs(localStorage, DEFAULT_PING_PREFS));
afterEach(cleanup);

const seam = (requestPermission: () => unknown, permission: NotificationPermission = 'default') =>
  ({ permission, requestPermission }) as unknown as NotificationSeam;

function setup(notification: NotificationSeam | null = null, catalog: SoundCatalog | null = CATALOG) {
  const preview = vi.fn();
  render(<PingSettingsDialog onClose={() => {}} notification={notification} preview={preview} catalog={catalog} />);
  return preview;
}
const notifySwitch = () => screen.getByRole('switch') as HTMLInputElement;

describe('PingSettingsDialog sound', () => {
  it('saves the chosen sound', () => {
    setup();
    fireEvent.click(screen.getByRole('radio', { name: 'horn' }));
    expect(readPingPrefs(localStorage).sound).toEqual({ type: 'library', name: 'horn' });
    fireEvent.click(screen.getByRole('radio', { name: 'None (silent)' }));
    expect(readPingPrefs(localStorage).sound).toEqual({ type: 'none' });
  });

  it('previewing leaves the selection and stored prefs alone', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Preview horn' }));
    expect((screen.getByRole('radio', { name: 'Built-in chime' }) as HTMLInputElement).checked).toBe(true);
    expect(readPingPrefs(localStorage)).toEqual(DEFAULT_PING_PREFS);
  });

  it('previews audible options only', () => {
    const preview = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Preview bell' }));
    expect(preview).toHaveBeenCalledWith({ type: 'library', name: 'bell' }, CATALOG);
    expect(screen.queryByRole('button', { name: 'Preview None (silent)' })).toBeNull();
  });

  it('selects the built-in option with a note when the saved sound is gone', () => {
    writePingPrefs(localStorage, { sound: { type: 'library', name: 'gone' }, notify: false });
    setup();
    expect((screen.getByRole('radio', { name: 'Built-in chime' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/no longer available/)).toBeTruthy();
  });

  it('does not flag the saved sound while the catalog loads', () => {
    writePingPrefs(localStorage, { sound: { type: 'library', name: 'gone' }, notify: false });
    setup(null, null);
    expect(screen.queryByText(/no longer available/)).toBeNull();
  });
});

describe('PingSettingsDialog notifications', () => {
  it('saves on when permission is granted, and off again', async () => {
    setup(seam(() => Promise.resolve('granted')));
    fireEvent.click(notifySwitch());
    await waitFor(() => expect(readPingPrefs(localStorage).notify).toBe(true));
    fireEvent.click(notifySwitch());
    expect(readPingPrefs(localStorage).notify).toBe(false);
  });

  it.each(['denied', 'default'] as const)('stays off with a hint when permission is %s', async (result) => {
    setup(seam(() => Promise.resolve(result)));
    fireEvent.click(notifySwitch());
    await screen.findByText(/blocked/);
    expect(readPingPrefs(localStorage).notify).toBe(false);
    expect(notifySwitch().checked).toBe(false);
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('no'))],
    [
      'throws',
      () => {
        throw new Error('no');
      },
    ],
  ])('shows the hint when requestPermission %s', async (_name, request) => {
    setup(seam(request));
    fireEvent.click(notifySwitch());
    await screen.findByText(/blocked/);
    expect(readPingPrefs(localStorage).notify).toBe(false);
    expect(notifySwitch().disabled).toBe(false);
  });

  it('supports the callback form that returns nothing', async () => {
    setup(seam((cb?: (p: NotificationPermission) => void) => cb?.('granted')));
    fireEvent.click(notifySwitch());
    await waitFor(() => expect(readPingPrefs(localStorage).notify).toBe(true));
  });

  it('shows the hint when notify is saved but permission was revoked', () => {
    writePingPrefs(localStorage, { sound: { type: 'builtin' }, notify: true });
    setup(seam(() => Promise.resolve('denied'), 'denied'));
    expect(screen.getByText(/blocked/)).toBeTruthy();
    expect(notifySwitch().getAttribute('aria-describedby')).toBeTruthy();
  });

  it('is disabled with an explanation when unsupported', () => {
    setup(null);
    expect(notifySwitch().disabled).toBe(true);
    expect(screen.getByText(/doesn't support/)).toBeTruthy();
  });
});
