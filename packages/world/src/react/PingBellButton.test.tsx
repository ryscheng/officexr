// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PingBellButton } from './PingBellButton.tsx';

afterEach(cleanup);

describe('PingBellButton', () => {
  it('pings on click without the click reaching its parent', () => {
    const onPing = vi.fn();
    const onParentClick = vi.fn();
    const onParentMouseDown = vi.fn();
    render(
      <div onClick={onParentClick} onMouseDown={onParentMouseDown}>
        <PingBellButton name="Ada" onPing={onPing} />
      </div>,
    );
    const bell = screen.getByRole('button', { name: 'Ping Ada' });
    fireEvent.mouseDown(bell);
    fireEvent.click(bell);
    expect(onPing).toHaveBeenCalledOnce();
    expect(onParentClick).not.toHaveBeenCalled();
    expect(onParentMouseDown).not.toHaveBeenCalled();
  });

  it('stops pointerdown from reaching its parent', () => {
    const onParentPointerDown = vi.fn();
    render(
      <div onPointerDown={onParentPointerDown}>
        <PingBellButton name="Ada" onPing={() => {}} />
      </div>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Ping Ada' }));
    expect(onParentPointerDown).not.toHaveBeenCalled();
  });

  it('labels a nameless player generically', () => {
    render(<PingBellButton name="" onPing={() => {}} />);
    expect(screen.getByRole('button', { name: 'Ping player' })).toBeTruthy();
  });
});
