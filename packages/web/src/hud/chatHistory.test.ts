import { expect, it } from 'vitest';
import { createChatHistory } from './chatHistory';

const filled = () => {
  const h = createChatHistory();
  h.push('one');
  h.push('two');
  return h;
};

it('Up walks back through sent messages and stops at the oldest', () => {
  const h = filled();
  expect([h.older(''), h.older('two'), h.older('one')]).toEqual(['two', 'one', 'one']);
});

it('Down walks forward and ends on an empty draft', () => {
  const h = filled();
  h.older('');
  h.older('two');
  expect([h.newer(), h.newer(), h.newer()]).toEqual(['two', '', null]);
});

it('Up and Down are plain text keys when the draft has text that is not from history', () => {
  const h = filled();
  expect(h.older('half typed')).toBeNull();
  expect(h.newer()).toBeNull();
});

it('editing a recalled message stops browsing', () => {
  const h = filled();
  h.older('');
  h.stopBrowsing();
  expect(h.older('two!')).toBeNull();
});

it('has nothing to offer before the first message, and skips an immediate repeat', () => {
  const h = createChatHistory();
  expect(h.older('')).toBeNull();
  h.push('same');
  h.push('same');
  expect([h.older(''), h.older('same')]).toEqual(['same', 'same']);
});

it('keeps the newest 50', () => {
  const h = createChatHistory();
  for (let i = 0; i < 60; i += 1) h.push(`m${i}`);
  let last: string | null = null;
  for (let i = 0; i < 60; i += 1) last = h.older(i === 0 ? '' : 'x') ?? last;
  expect(last).toBe('m10');
});
