// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHotkey } from './useHotkey';

afterEach(cleanup);

function Probe({ onPress, enabled = true }: { onPress: () => void; enabled?: boolean }) {
  useHotkey('m', onPress, enabled);
  return <input aria-label="field" />;
}

describe('useHotkey', () => {
  it('runs for the plain key, in either case', () => {
    const onPress = vi.fn();
    render(<Probe onPress={onPress} />);
    fireEvent.keyDown(window, { key: 'm' });
    fireEvent.keyDown(window, { key: 'M', shiftKey: false });
    expect(onPress).toHaveBeenCalledTimes(2);
  });

  it('ignores modified presses, repeats and other keys', () => {
    const onPress = vi.fn();
    render(<Probe onPress={onPress} />);
    fireEvent.keyDown(window, { key: 'm', altKey: true });
    fireEvent.keyDown(window, { key: 'm', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'm', repeat: true });
    fireEvent.keyDown(window, { key: 'n' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('stands down while typing in a field and while a dialog is open', () => {
    const onPress = vi.fn();
    const { getByLabelText } = render(<Probe onPress={onPress} />);
    fireEvent.keyDown(getByLabelText('field'), { key: 'm' });
    expect(onPress).not.toHaveBeenCalled();
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    fireEvent.keyDown(window, { key: 'm' });
    expect(onPress).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('stands down while focus is inside a no-hotkeys area, such as the new mission form', () => {
    const onPress = vi.fn();
    render(
      <>
        <Probe onPress={onPress} />
        <div data-no-hotkeys>
          <button type="button">chip</button>
        </div>
      </>,
    );
    fireEvent.keyDown(document.querySelector('button')!, { key: 'm' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does nothing while disabled', () => {
    const onPress = vi.fn();
    render(<Probe onPress={onPress} enabled={false} />);
    fireEvent.keyDown(window, { key: 'm' });
    expect(onPress).not.toHaveBeenCalled();
  });
});
