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
});
