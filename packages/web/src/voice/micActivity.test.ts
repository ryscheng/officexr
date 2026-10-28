import { describe, expect, it, vi } from 'vitest';
import {
  createMicActivityMeter,
  NOT_SPEAKING,
  SPEAKING_HOLD_MS,
  SPEAKING_LEVEL,
  speakingFromLevel,
  type MeterAudioContext,
  type MicActivityDeps,
} from './micActivity';

describe('speakingFromLevel', () => {
  const loud = SPEAKING_LEVEL * 2;

  it('starts speaking when the level crosses the threshold', () => {
    expect(speakingFromLevel(SPEAKING_LEVEL, 0, NOT_SPEAKING).speaking).toBe(false);
    expect(speakingFromLevel(loud, 5, NOT_SPEAKING)).toEqual({ speaking: true, lastLoudAt: 5 });
  });

  it('holds through a pause shorter than the hold, then releases', () => {
    const talking = speakingFromLevel(loud, 1000, NOT_SPEAKING);
    const pause = speakingFromLevel(0, 1000 + SPEAKING_HOLD_MS - 1, talking);
    expect(pause.speaking).toBe(true);
    expect(speakingFromLevel(0, 1000 + SPEAKING_HOLD_MS, pause).speaking).toBe(false);
  });

  it('restarts the hold on each loud frame', () => {
    let state = speakingFromLevel(loud, 0, NOT_SPEAKING);
    state = speakingFromLevel(loud, 250, state);
    expect(speakingFromLevel(0, 500, state).speaking).toBe(true);
  });
});

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

function setup({ state = 'running', denied = false }: { state?: string; denied?: boolean } = {}) {
  const track = new FakeTrack();
  let level = 0;
  let tick = () => {};
  let timerCancelled = false;
  const context = {
    state,
    resumed: 0,
    closed: false,
    resume() {
      this.resumed++;
      return Promise.resolve();
    },
    close() {
      this.closed = true;
      return Promise.resolve();
    },
    createAnalyser: () => ({
      fftSize: 4,
      getFloatTimeDomainData: (samples: Float32Array) => samples.fill(level),
    }),
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
  };
  const gestures = new EventTarget();
  let clock = 0;
  const getUserMedia = vi.fn(async () => {
    if (denied) {
      throw new DOMException('denied', 'NotAllowedError');
    }
    return { getTracks: () => [track] } as unknown as MediaStream;
  });
  const deps: MicActivityDeps = {
    getUserMedia,
    createAudioContext: () => context as unknown as MeterAudioContext,
    setInterval: (fn) => {
      tick = fn;
      return () => {
        timerCancelled = true;
      };
    },
    now: () => clock,
    gestureTarget: gestures,
  };
  const meter = createMicActivityMeter(deps);
  const changes: boolean[] = [];
  meter.onChange((speaking) => changes.push(speaking));
  return {
    meter,
    track,
    context,
    gestures,
    getUserMedia,
    changes,
    isTimerCancelled: () => timerCancelled,
    hear: (next: number, at: number) => {
      level = next;
      clock = at;
      tick();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createMicActivityMeter', () => {
  it('opens a stream on start and releases it on stop', async () => {
    const t = setup();
    t.meter.start();
    await flush();
    expect(t.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(t.track.stopped).toBe(false);

    t.meter.stop();
    expect(t.track.stopped).toBe(true);
    expect(t.context.closed).toBe(true);
    expect(t.isTimerCancelled()).toBe(true);
  });

  it('reports speaking while loud, holds briefly, and reports silence on stop', async () => {
    const t = setup();
    t.meter.start();
    await flush();
    t.hear(0.5, 0);
    t.hear(0, 100);
    expect(t.changes).toEqual([true]);
    t.hear(0, 400);
    expect(t.changes).toEqual([true, false]);

    t.hear(0.5, 500);
    t.meter.stop();
    expect(t.changes).toEqual([true, false, true, false]);
  });

  it('opens one stream however often it is started', async () => {
    const t = setup();
    t.meter.start();
    t.meter.start();
    await flush();
    t.meter.start();
    expect(t.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('releases a stream that arrives after stop', async () => {
    const t = setup();
    t.meter.start();
    t.meter.stop();
    await flush();
    expect(t.track.stopped).toBe(true);
    expect(t.isTimerCancelled()).toBe(false);
  });

  it('never reports speaking when permission is denied, and does not retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = setup({ denied: true });
    t.meter.start();
    await flush();
    t.meter.stop();
    t.meter.start();
    await flush();
    expect(t.getUserMedia).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(t.changes).toEqual([]);
    warn.mockRestore();
  });

  it('resumes a suspended context on the next gesture', async () => {
    const t = setup({ state: 'suspended' });
    t.meter.start();
    await flush();
    expect(t.context.resumed).toBe(0);
    t.gestures.dispatchEvent(new Event('pointerdown'));
    expect(t.context.resumed).toBe(1);
  });

  it('does not resume a running context on a gesture', async () => {
    const t = setup();
    t.meter.start();
    await flush();
    t.gestures.dispatchEvent(new Event('keydown'));
    expect(t.context.resumed).toBe(0);
  });
});
