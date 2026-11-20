// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFold, type FoldStorage } from '../foldPrefs';
import { FoldablePanel } from './FoldablePanel';

afterEach(cleanup);

const storage = (): FoldStorage => {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

function Demo({ store, defaultFolded = false }: { store: FoldStorage; defaultFolded?: boolean }) {
  const fold = useFold('demo', defaultFolded, store);
  return (
    <FoldablePanel fold={fold} title="Demo" label="demo" headerExtra={<span>extra</span>}>
      <p>body</p>
    </FoldablePanel>
  );
}

describe('FoldablePanel', () => {
  it('shows the body and reports the toggle as expanded', () => {
    render(<Demo store={storage()} />);
    expect(screen.getByText('body')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Collapse demo' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
  });

  it('keeps the title and header extra when folded, and drops the body', () => {
    render(<Demo store={storage()} defaultFolded />);
    expect(screen.queryByText('body')).toBeNull();
    expect(screen.getByText('Demo')).toBeTruthy();
    expect(screen.getByText('extra')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Expand demo' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBeNull();
  });

  it('toggles from the keyboard-reachable button', () => {
    render(<Demo store={storage()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse demo' }));
    expect(screen.queryByText('body')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand demo' }));
    expect(screen.getByText('body')).toBeTruthy();
  });
});
