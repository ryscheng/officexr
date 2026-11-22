import { describe, expect, it } from 'vitest';
import { busyReason } from './talkAvailability';

const free = { name: 'Ana Ruiz', status: 'available' as const, focus: false, jitsiRoom: null };

describe('busyReason', () => {
  it('is null for a free person and for someone who is gone', () => {
    expect(busyReason(free)).toBeNull();
    expect(busyReason(undefined)).toBeNull();
  });

  it('names the reason in the order call, focus, away', () => {
    expect(busyReason({ ...free, jitsiRoom: 'r', focus: true, status: 'away' })).toBe('Ana is in a call');
    expect(busyReason({ ...free, focus: true, status: 'away' })).toBe('Ana is focusing');
    expect(busyReason({ ...free, status: 'away' })).toBe('Ana is away');
  });
});
