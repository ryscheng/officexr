/**
 * TDD tests for the new CommandHistory component (history panel UI).
 * Written BEFORE the new implementation replaces the old one.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommandHistory } from './CommandHistory.tsx';

function makeNodes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `node-${i + 1}`,
    label: `Action ${i + 1}`,
  }));
}

describe('CommandHistory (history panel)', () => {
  // 1. empty state
  it('renders "No actions yet." when nodes is empty', () => {
    const { container } = render(
      <CommandHistory nodes={[]} currentNodeId={null} onJumpTo={() => {}} />,
    );
    expect(container.textContent).toContain('No actions yet.');
  });

  // 2. renders node labels
  it('renders node labels', () => {
    const nodes = [{ id: 'n1', label: 'Place block-grass' }];
    const { container } = render(
      <CommandHistory nodes={nodes} currentNodeId="n1" onJumpTo={() => {}} />,
    );
    expect(container.textContent).toContain('Place block-grass');
  });

  // 3. current node highlighted
  it('current node has data-current="true"', () => {
    const nodes = [
      { id: 'n1', label: 'Action 1' },
      { id: 'n2', label: 'Action 2' },
    ];
    render(
      <CommandHistory nodes={nodes} currentNodeId="n1" onJumpTo={() => {}} />,
    );
    const buttons = screen.getAllByRole('button');
    const currentBtn = buttons.find((b) => b.textContent?.includes('Action 1'));
    expect(currentBtn).toBeDefined();
    expect(currentBtn?.getAttribute('data-current')).toBe('true');
  });

  // 4. future nodes greyed
  it('future nodes have data-future="true"', () => {
    const nodes = [
      { id: 'n1', label: 'Action 1' },
      { id: 'n2', label: 'Action 2' },
      { id: 'n3', label: 'Action 3' },
    ];
    // currentNodeId = n1: n2 and n3 are future
    render(
      <CommandHistory nodes={nodes} currentNodeId="n1" onJumpTo={() => {}} />,
    );
    const buttons = screen.getAllByRole('button');
    const futureBtn2 = buttons.find((b) => b.textContent?.includes('Action 2'));
    const futureBtn3 = buttons.find((b) => b.textContent?.includes('Action 3'));
    expect(futureBtn2?.getAttribute('data-future')).toBe('true');
    expect(futureBtn3?.getAttribute('data-future')).toBe('true');
  });

  // 5. click triggers onJumpTo
  it('clicking a row calls onJumpTo with that node id', () => {
    const onJumpTo = vi.fn();
    const nodes = [
      { id: 'n1', label: 'Action 1' },
      { id: 'n2', label: 'Action 2' },
    ];
    render(
      <CommandHistory nodes={nodes} currentNodeId="n2" onJumpTo={onJumpTo} />,
    );
    const buttons = screen.getAllByRole('button');
    const btn1 = buttons.find((b) => b.textContent?.includes('Action 1'));
    fireEvent.click(btn1!);
    expect(onJumpTo).toHaveBeenCalledWith('n1');
  });

  // 6. header count
  it('shows "History (3)" when 3 nodes', () => {
    const nodes = makeNodes(3);
    const { container } = render(
      <CommandHistory nodes={nodes} currentNodeId={nodes[2].id} onJumpTo={() => {}} />,
    );
    expect(container.textContent).toContain('History (3)');
  });

  // 7. no delete button
  it('no delete button (no title="Delete" or × text in any button)', () => {
    const nodes = makeNodes(2);
    const { container } = render(
      <CommandHistory nodes={nodes} currentNodeId={nodes[0].id} onJumpTo={() => {}} />,
    );
    const deleteBtn = container.querySelector('[title="Delete"]');
    expect(deleteBtn).toBeNull();
    // No × text in any button
    const buttons = container.querySelectorAll('button');
    const hasX = Array.from(buttons).some((b) => b.textContent?.trim() === '×');
    expect(hasX).toBe(false);
  });
});
