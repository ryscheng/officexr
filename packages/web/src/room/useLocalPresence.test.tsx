// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { EventEmitter } from 'node:events';
import type { MicState, PresenceStatus } from '@officexr/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MicActivityMeter } from '../voice/micActivity';
import { useLocalPresence, type LocalPresenceDeps, type PresenceVoice } from './useLocalPresence';

afterEach(cleanup);

class FakeMeter implements MicActivityMeter {
  running = false;
  private listeners = new Set<(speaking: boolean) => void>();
  start() {
    this.running = true;
  }
  stop() {
    this.running = false;
    this.say(false);
  }
  onChange(listener: (speaking: boolean) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  say(speaking: boolean) {
    this.listeners.forEach((listener) => listener(speaking));
  }
}

class FakeVoice implements PresenceVoice {
  state = 'idle';
  micMuted = false;
  private events = new EventEmitter();
  getConnectionState() {
    return this.state as ReturnType<PresenceVoice['getConnectionState']>;
  }
  isMicMuted() {
    return this.micMuted;
  }
  on: PresenceVoice['on'] = (name, handler) => {
    this.events.on(name, handler);
    return () => this.events.off(name, handler);
  };
  onMuteChange(listener: () => void) {
    this.events.on('mute', listener);
    return () => this.events.off('mute', listener);
  }
  setState(state: string) {
    this.state = state;
    this.events.emit('connection-state-change', { state });
  }
  setMuted(muted: boolean) {
    this.micMuted = muted;
    this.events.emit('mute');
  }
}

function setup(voice: FakeVoice | null) {
  const doc = { hidden: false, focused: true };
  const meters: FakeMeter[] = [];
  const deps: LocalPresenceDeps = {
    readDocument: () => ({ ...doc }),
    createMeter: () => {
      const meter = new FakeMeter();
      meters.push(meter);
      return meter;
    },
  };
  const setSelfPresence = vi.fn<(patch: { status?: PresenceStatus; mic?: MicState }) => void>();
  renderHook(() => useLocalPresence({ setSelfPresence }, voice, deps));
  return { doc, meters, setSelfPresence };
}

describe('useLocalPresence', () => {
  it('sends nothing while already available with no call', () => {
    const { setSelfPresence } = setup(null);
    expect(setSelfPresence).not.toHaveBeenCalled();
  });

  it('goes away when hidden or unfocused, and back', () => {
    const { doc, setSelfPresence } = setup(null);
    doc.hidden = true;
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(setSelfPresence).toHaveBeenLastCalledWith({ status: 'away', mic: 'none' });

    doc.hidden = false;
    doc.focused = false;
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(setSelfPresence).toHaveBeenCalledTimes(1);

    doc.focused = true;
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(setSelfPresence).toHaveBeenLastCalledWith({ status: 'available', mic: 'none' });
    expect(setSelfPresence).toHaveBeenCalledTimes(2);
  });

  it('stays available when blur only moves focus into an iframe', () => {
    const { setSelfPresence } = setup(null);
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(setSelfPresence).not.toHaveBeenCalled();
  });

  it('is away from mount when the tab starts hidden', () => {
    const doc = { hidden: true, focused: true };
    const setSelfPresence = vi.fn();
    renderHook(() => useLocalPresence({ setSelfPresence }, null, { readDocument: () => doc, createMeter: () => new FakeMeter() }));
    expect(setSelfPresence).toHaveBeenCalledExactlyOnceWith({ status: 'away', mic: 'none' });
  });

  it('follows the call, mute and the meter, sending only changes', () => {
    const voice = new FakeVoice();
    const { meters, setSelfPresence } = setup(voice);
    expect(meters).toHaveLength(0);

    act(() => voice.setState('joining'));
    expect(setSelfPresence).not.toHaveBeenCalled();

    act(() => voice.setState('connected'));
    expect(setSelfPresence).toHaveBeenLastCalledWith({ status: 'available', mic: 'silent' });
    expect(meters[0].running).toBe(true);

    act(() => meters[0].say(true));
    expect(setSelfPresence).toHaveBeenLastCalledWith({ status: 'available', mic: 'speaking' });
    act(() => meters[0].say(true));
    expect(setSelfPresence).toHaveBeenCalledTimes(2);

    act(() => voice.setMuted(true));
    expect(setSelfPresence).toHaveBeenLastCalledWith({ status: 'available', mic: 'muted' });
    expect(meters[0].running).toBe(false);

    act(() => voice.setMuted(false));
    expect(meters[0].running).toBe(true);
    expect(setSelfPresence).toHaveBeenLastCalledWith({ status: 'available', mic: 'silent' });

    act(() => voice.setState('idle'));
    expect(setSelfPresence).toHaveBeenLastCalledWith({ status: 'available', mic: 'none' });
    expect(meters[0].running).toBe(false);
    expect(setSelfPresence).toHaveBeenCalledTimes(5);
  });

  it('uses a fresh meter for each call', () => {
    const voice = new FakeVoice();
    const { meters } = setup(voice);
    act(() => voice.setState('connected'));
    act(() => voice.setState('idle'));
    act(() => voice.setState('connected'));
    expect(meters).toHaveLength(2);
  });

  it('does not run the meter for a call that starts muted', () => {
    const voice = new FakeVoice();
    voice.micMuted = true;
    const { meters, setSelfPresence } = setup(voice);
    act(() => voice.setState('connected'));
    expect(meters[0].running).toBe(false);
    expect(setSelfPresence).toHaveBeenLastCalledWith({ status: 'available', mic: 'muted' });
  });
});
