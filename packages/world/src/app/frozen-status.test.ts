import { describe, expect, it } from 'vitest';
import { frozenStatusLabel } from './frozen-status.ts';

const utcTime = (at: Date) => at.toISOString().slice(11, 16);
const zoned = (timeZone: string) => (at: Date) => at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone });

describe('frozenStatusLabel', () => {
  it('is Away with nothing known', () => {
    expect(frozenStatusLabel({})).toBe('Away');
  });

  it('shows a meeting and free time from the calendar', () => {
    expect(frozenStatusLabel({ calendar: { busy: true, until: '2026-11-20T15:00:00.000Z' } }, { formatTime: utcTime })).toBe('In a meeting until 15:00');
    expect(frozenStatusLabel({ calendar: { busy: false, until: '2026-11-20T16:00:00.000Z' } }, { formatTime: utcTime })).toBe('Free until 16:00');
  });

  it('formats the same instant in each viewer zone', () => {
    const calendar = { busy: true, until: '2026-11-20T15:00:00.000Z' };
    expect(frozenStatusLabel({ calendar }, { formatTime: zoned('Asia/Tokyo') })).toBe('In a meeting until 00:00');
    expect(frozenStatusLabel({ calendar }, { formatTime: zoned('America/New_York') })).toBe('In a meeting until 10:00');
  });

  it('uses the browser zone by default and does not throw', () => {
    expect(frozenStatusLabel({ calendar: { busy: false, until: '2026-11-20T16:00:00.000Z' } })).toMatch(/^Free until \d/);
  });

  it('prefers the calendar over Slack, and shows Slack when there is no calendar', () => {
    const slack = { text: 'On vacation', emoji: ':palm_tree:' };
    expect(frozenStatusLabel({ slack, calendar: { busy: false, until: '2026-11-20T16:00:00.000Z' } }, { formatTime: utcTime })).toBe('Free until 16:00');
    expect(frozenStatusLabel({ slack })).toBe('🌴 On vacation');
  });

  it('shows an unknown Slack emoji as text only, and an empty Slack status as Away', () => {
    expect(frozenStatusLabel({ slack: { text: 'Heads down', emoji: ':custom_thing:' } })).toBe('Heads down');
    expect(frozenStatusLabel({ slack: { text: '' } })).toBe('Away');
  });

  it('falls back when the calendar instant is not a date', () => {
    expect(frozenStatusLabel({ calendar: { busy: true, until: 'soon' } })).toBe('Away');
  });
});
