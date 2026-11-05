import { describe, expect, it, vi } from 'vitest';
import { maybeNotify, type PingNotifierEnv } from './pingNotifier';

function setup(over: { notify?: boolean; permission?: NotificationPermission; hidden?: boolean; focused?: boolean; supported?: boolean } = {}) {
  const { notify = true, permission = 'granted', hidden = true, focused = false, supported = true } = over;
  const created: Array<{ title: string; options?: NotificationOptions; close: () => void; onclick: (() => void) | null }> = [];
  class FakeNotification {
    static permission = permission;
    close = vi.fn();
    onclick: (() => void) | null = null;
    constructor(
      public title: string,
      public options?: NotificationOptions,
    ) {
      created.push(this);
    }
  }
  const win = { focus: vi.fn() };
  const env = {
    Notification: supported ? FakeNotification : undefined,
    document: { hidden, hasFocus: () => focused },
    window: win,
  } as unknown as PingNotifierEnv;
  const run = () => maybeNotify({ sound: { type: 'builtin' }, notify }, 'Ada', env);
  return { run, created, win };
}

describe('maybeNotify', () => {
  it('notifies by sender name when every condition holds', () => {
    const { run, created } = setup();
    run();
    expect(created).toHaveLength(1);
    expect(created[0].title).toBe('Ada pinged you');
    expect(created[0].options).toEqual({ tag: 'officexr-ping' });
  });

  it('notifies for a visible but unfocused tab', () => {
    const { run, created } = setup({ hidden: false, focused: false });
    run();
    expect(created).toHaveLength(1);
  });

  it.each([
    ['notify is off', { notify: false }],
    ['permission is not granted', { permission: 'default' as const }],
    ['the tab is visible and focused', { hidden: false, focused: true }],
    ['Notification is unsupported', { supported: false }],
  ])('stays quiet when %s', (_name, over) => {
    const { run, created } = setup(over);
    run();
    expect(created).toHaveLength(0);
  });

  it('focuses the window and closes on click', () => {
    const { run, created, win } = setup();
    run();
    created[0].onclick?.();
    expect(win.focus).toHaveBeenCalled();
    expect(created[0].close).toHaveBeenCalled();
  });
});
