// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorldFocus } from '@officexr/world/top-down';
import { useRefocusOnMovementKey } from './useRefocusOnMovementKey';

const useBoth = () => {
  useRefocusOnMovementKey();
  return useWorldFocus();
};

const setup = () => {
  const view = render(
    <>
      <aside data-studio-panel="true">
        <button>in panel</button>
        <input aria-label="name" />
        <select aria-label="pick">
          <option>a</option>
        </select>
      </aside>
    </>,
  );
  const hook = renderHook(useBoth);
  const seen: string[] = [];
  window.addEventListener('keydown', (e) => seen.push(e.key));
  const release = () => fireEvent.mouseDown(view.getByText('in panel'));
  return { view, hook, seen, release };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('refocuses on W outside inputs and replays the press for the world', () => {
  const { hook, seen, release, view } = setup();
  release();
  expect(hook.result.current).toBe(false);
  fireEvent.keyDown(view.getByText('in panel'), { key: 'w' });
  expect(hook.result.current).toBe(true);
  act(() => vi.advanceTimersByTime(20));
  expect(seen.filter((k) => k === 'w')).toHaveLength(2);
});

it('does not replay a press that was released before the world listened', () => {
  const { hook, seen, release, view } = setup();
  release();
  fireEvent.keyDown(view.getByText('in panel'), { key: 'ArrowUp' });
  fireEvent.keyUp(view.getByText('in panel'), { key: 'ArrowUp' });
  act(() => vi.advanceTimersByTime(20));
  expect(hook.result.current).toBe(true);
  expect(seen.filter((k) => k === 'ArrowUp')).toHaveLength(1);
});

it.each(['input', 'select'])('leaves focus alone for a key in a %s', (tag) => {
  const { hook, release, view } = setup();
  release();
  fireEvent.keyDown(view.container.querySelector(tag)!, { key: 'a' });
  expect(hook.result.current).toBe(false);
});

it('leaves focus alone while a dialog is open', () => {
  const { hook, release, view } = setup();
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  release();
  fireEvent.keyDown(view.getByText('in panel'), { key: 'd' });
  expect(hook.result.current).toBe(false);
  dialog.remove();
});

it('ignores other keys and shortcuts with a modifier', () => {
  const { hook, release, view } = setup();
  release();
  fireEvent.keyDown(view.getByText('in panel'), { key: 'q' });
  fireEvent.keyDown(view.getByText('in panel'), { key: 's', ctrlKey: true });
  expect(hook.result.current).toBe(false);
});

it('refocuses on a click outside a panel', () => {
  const { hook, release } = setup();
  release();
  expect(hook.result.current).toBe(false);
  fireEvent.mouseDown(document.body);
  expect(hook.result.current).toBe(true);
});
