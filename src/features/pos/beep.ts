// The checkout beep: a short high tone when a scan is accepted, a low double
// beep when it is not — the sound every shop scanner makes, so the seller knows
// WITHOUT looking at the screen. Generated, not a file: nothing to bundle, load
// or get wrong, and it works offline.
//
// An AudioContext may only start from a user gesture, so `unlockAudio()` is
// called on the tap that begins selling; the beeps themselves can then play
// when a scan finishes. Every function is safe to call anywhere — with no audio
// support, or sound switched off, it does nothing and never throws.

const KEY = 'daftar.pos.sound';

export const soundEnabled = (): boolean => {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
};
export const setSoundEnabled = (on: boolean): void => {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* a convenience only */ }
};

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = typeof window !== 'undefined'
    ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
    : undefined;
  if (!Ctor) return null;
  try { ctx = new Ctor(); } catch { ctx = null; }
  return ctx;
}

/** Call from a tap handler, before the sound is needed. */
export function unlockAudio(): void {
  const c = context();
  if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
}

function tone(freq: number, startIn: number, length: number, type: OscillatorType, volume: number): void {
  const c = context();
  if (!c) return;
  try {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = c.currentTime + startIn;
    osc.type = type;
    osc.frequency.value = freq;
    // A quick fade in and out: a hard on/off clicks.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.008);
    gain.gain.setValueAtTime(volume, t0 + length - 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + length + 0.02);
  } catch { /* sound is a nicety; a failure must never break a sale */ }
}

/** A scan was accepted. */
export function beepOk(): void {
  if (!soundEnabled()) return;
  tone(2000, 0, 0.12, 'square', 0.25);
}

/** A scan was refused (unknown code). */
export function beepBad(): void {
  if (!soundEnabled()) return;
  tone(260, 0, 0.14, 'square', 0.3);
  tone(260, 0.2, 0.14, 'square', 0.3);
}
