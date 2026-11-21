// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blocked, type BlockedVariant } from './Blocked';
import { fetchFailureVariant } from './fetchFailure';

afterEach(cleanup);

const COPY: [BlockedVariant, string, string, string | null][] = [
  ['officeNotFound', 'We can not find this office', 'Back to offices', null],
  ['pageNotFound', 'This page does not exist', 'Go to offices', null],
  ['offline', 'You are offline', 'Try again', 'Back to offices'],
  ['cannotConnect', 'We can not reach the office', 'Try again', 'Back to offices'],
  ['otherWindow', 'You are in this office in another window', 'Use this window', 'Back to offices'],
  ['crashed', 'The office view stopped', 'Try again', 'Back to offices'],
];

describe('Blocked', () => {
  it.each(COPY)('%s shows its cause, one primary action and the way back', (variant, title, primary, back) => {
    const onPrimary = vi.fn();
    render(<Blocked variant={variant} details="raw text" onPrimary={back ? onPrimary : undefined} />);
    expect(screen.getByRole('alert').textContent).toBe(title);
    if (back) {
      expect(screen.getByRole('button', { name: primary })).toBeTruthy();
      expect(screen.getByRole('link', { name: back }).getAttribute('href')).toBe('/');
    } else {
      expect(screen.getByRole('link', { name: primary }).getAttribute('href')).toBe('/');
      expect(screen.queryByRole('button', { name: primary })).toBeNull();
    }
  });

  it('keeps the raw text inside Details', () => {
    render(<Blocked variant="cannotConnect" details="HTTP 502" onPrimary={vi.fn()} />);
    const fold = screen.getByText('Details').closest('details')!;
    expect(fold.open).toBe(false);
    expect(fold.textContent).toContain('HTTP 502');
    expect(screen.getByRole('alert').textContent).not.toContain('HTTP');
  });

  it('omits Details when there is no raw text', () => {
    render(<Blocked variant="offline" onPrimary={vi.fn()} />);
    expect(screen.queryByText('Details')).toBeNull();
  });

  it('disables the primary action as Trying… while the call runs', async () => {
    let finish!: () => void;
    const onPrimary = vi.fn(() => new Promise<void>((r) => (finish = r)));
    render(<Blocked variant="cannotConnect" onPrimary={onPrimary} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const busy = (await screen.findByRole('button', { name: 'Trying…' })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    finish();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('alert').textContent).toBe('We can not reach the office');
  });
});

describe('fetchFailureVariant', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps 404 to the not-found variant', () => {
    expect(fetchFailureVariant(404)).toBe('officeNotFound');
    expect(fetchFailureVariant(404, 'cannotConnect')).toBe('cannotConnect');
  });

  it('maps an unanswered request to offline only when the browser is offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(fetchFailureVariant(undefined)).toBe('offline');
    vi.stubGlobal('navigator', { onLine: true });
    expect(fetchFailureVariant(undefined)).toBe('cannotConnect');
  });

  it('maps a server error to cannot connect', () => {
    expect(fetchFailureVariant(500)).toBe('cannotConnect');
  });
});
