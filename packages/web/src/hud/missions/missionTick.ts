import { readSfxPrefs } from "../../sfx/sfxPrefs";

let context: AudioContext | null = null;

export function playMissionTick(): void {
  try {
    const { enabled, volume } = readSfxPrefs(localStorage);
    if (!enabled || typeof AudioContext === "undefined") {
      return;
    }
    context ??= new AudioContext();
    const ctx = context;
    void ctx.resume();
    const start = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 1320;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, 0.2 * volume),
      start + 0.01,
    );
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.12);
  } catch {
    return;
  }
}
