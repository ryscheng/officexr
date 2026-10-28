export interface SpeakingState {
  speaking: boolean;
  lastLoudAt: number;
}

export const NOT_SPEAKING: SpeakingState = { speaking: false, lastLoudAt: -Infinity };

/** RMS of a float time-domain frame (-1..1) above which the mic counts as loud. */
export const SPEAKING_LEVEL = 0.02;
/** Keeps pauses between words from reading as silence. */
export const SPEAKING_HOLD_MS = 300;

export function speakingFromLevel(level: number, now: number, prev: SpeakingState): SpeakingState {
  if (level > SPEAKING_LEVEL) {
    return { speaking: true, lastLoudAt: now };
  }
  return { speaking: prev.speaking && now - prev.lastLoudAt < SPEAKING_HOLD_MS, lastLoudAt: prev.lastLoudAt };
}

const rms = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);

export type MeterAudioContext = Pick<AudioContext, 'state' | 'resume' | 'close' | 'createAnalyser' | 'createMediaStreamSource'>;

export interface MicActivityDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(): MeterAudioContext;
  /** Returns a function that cancels the timer. */
  setInterval(tick: () => void, ms: number): () => void;
  now(): number;
  /** Where the first user gesture is heard, to resume a context the browser started suspended. */
  gestureTarget: EventTarget;
}

export interface MicActivityMeter {
  /** Opens the mic and starts metering; a no-op while running, or after the mic could not be opened. */
  start(): void;
  /** Releases the mic and reports not speaking. */
  stop(): void;
  onChange(listener: (speaking: boolean) => void): () => void;
}

const TICK_MS = 100;
const GESTURES = ['pointerdown', 'keydown'];

const browserMicDeps = (): MicActivityDeps => ({
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createAudioContext: () => new AudioContext(),
  setInterval: (tick, ms) => {
    const id = window.setInterval(tick, ms);
    return () => window.clearInterval(id);
  },
  now: () => Date.now(),
  gestureTarget: window,
});

/**
 * Measures how loud the local mic is, on its own capture stream (Jitsi's lives in a
 * cross-origin iframe). Audio is only reduced to a level; nothing is recorded or sent.
 * Create one per call: a mic that can't be opened stays unavailable for that meter's lifetime.
 */
export function createMicActivityMeter(deps: MicActivityDeps = browserMicDeps()): MicActivityMeter {
  const listeners = new Set<(speaking: boolean) => void>();
  let release: (() => void) | null = null;
  let wanted = false;
  // Lets a stop() (or stop/start) while the permission prompt is open discard the stale stream.
  let generation = 0;
  let failed = false;
  let state = NOT_SPEAKING;

  const report = (next: SpeakingState) => {
    const changed = next.speaking !== state.speaking;
    state = next;
    if (changed) {
      listeners.forEach((listener) => listener(next.speaking));
    }
  };

  async function open(mine: number) {
    const stream = await deps.getUserMedia({ audio: true });
    const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
    if (mine !== generation) {
      stopTracks();
      return;
    }
    try {
      const context = deps.createAudioContext();
      const analyser = context.createAnalyser();
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const resume = () => {
        void context.resume();
      };
      if (context.state === 'suspended') {
        GESTURES.forEach((type) => deps.gestureTarget.addEventListener(type, resume, { once: true }));
      }
      const cancelTimer = deps.setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        report(speakingFromLevel(rms(samples), deps.now(), state));
      }, TICK_MS);
      release = () => {
        cancelTimer();
        GESTURES.forEach((type) => deps.gestureTarget.removeEventListener(type, resume));
        source.disconnect();
        stopTracks();
        void context.close();
      };
    } catch (err) {
      stopTracks();
      throw err;
    }
  }

  return {
    start() {
      if (wanted || failed) {
        return;
      }
      wanted = true;
      const mine = ++generation;
      open(mine).catch((err: unknown) => {
        if (mine === generation) {
          failed = true;
          wanted = false;
        }
        console.warn('Mic activity unavailable; reporting silent:', err);
      });
    },
    stop() {
      wanted = false;
      generation++;
      release?.();
      release = null;
      report(NOT_SPEAKING);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
